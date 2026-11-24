import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase', 'migrations');

async function initSupabaseShim(db: PGlite) {
  await db.exec(`
    create schema if not exists auth;
    create schema if not exists storage;

    do $$ begin
      create role authenticated;
    exception when duplicate_object then null;
    end $$;

    do $$ begin
      create role anon;
    exception when duplicate_object then null;
    end $$;

    do $$ begin
      create role service_role;
    exception when duplicate_object then null;
    end $$;

    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      raw_app_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );

    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text
    );
    alter table storage.objects enable row level security;

    do $$ begin
      create publication supabase_realtime;
    exception when duplicate_object then null;
    end $$;
  `);
}

async function setAuthUid(db: PGlite, uid: string | null) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

describe('PGlite SQL migrations 001–030 execution & security invariants', () => {
  it('executes all 001–030 migrations cleanly and enforces sign-up, change-request, storage, org-seed, station-code, PM credit, PM locations, route store, and audit invariants', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await initSupabaseShim(db);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    assert.ok(files.length >= 30, `Expected >= 30 migrations, found ${files.length}`);

    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await db.exec(sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.fail(`Migration ${f} failed in PGlite: ${msg}`);
      }
    }

    // 1. 032/019 Sign-up bootstrap lockdown: empty DB blocks sign-ups; bootstrap creates org; sign-up starts as inactive viewer; explicit helper promotes admin
    const adminId = '11111111-1111-4111-8111-111111111111';
    const mgr1Id = '22222222-2222-4222-8222-222222222222';
    const mgrApproverId = '33333333-3333-4333-8333-333333333333';

    const bootPrivs = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
      `select
         has_function_privilege('public', 'bootstrap_initial_org_admin(text, text, text)', 'EXECUTE') as pub,
         has_function_privilege('anon', 'bootstrap_initial_org_admin(text, text, text)', 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'bootstrap_initial_org_admin(text, text, text)', 'EXECUTE') as auth`,
    );
    assert.equal(bootPrivs.rows[0]?.pub, false);
    assert.equal(bootPrivs.rows[0]?.anon, false);
    assert.equal(bootPrivs.rows[0]?.auth, false);

    await assert.rejects(
      () =>
        db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'stranger@bpwi.test', $2::jsonb)`, [
          adminId,
          JSON.stringify({ full_name: 'Stranger' }),
        ]),
      /Organization is not initialized/i,
    );

    await db.query(`select bootstrap_initial_org_admin('BP Waterworks, Inc.')`);

    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'admin@bpwi.test', $2::jsonb)`, [
      adminId,
      JSON.stringify({ full_name: 'Admin User' }),
    ]);

    const p1Before = await db.query<{ role: string; is_active: boolean }>(
      `select role::text, is_active from user_profiles where id = $1`,
      [adminId],
    );
    assert.equal(p1Before.rows[0]?.role, 'viewer');
    assert.equal(p1Before.rows[0]?.is_active, false);

    await db.query(`select bootstrap_initial_org_admin('BP Waterworks, Inc.', 'admin@bpwi.test', 'Admin User')`);

    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'manager1@bpwi.test', $2::jsonb)`, [
      mgr1Id,
      JSON.stringify({ full_name: 'Pending Manager' }),
    ]);

    const p1 = await db.query<{ role: string; is_active: boolean; organization_id: string }>(
      `select role::text, is_active, organization_id from user_profiles where id = $1`,
      [adminId],
    );
    assert.equal(p1.rows[0]?.role, 'admin');
    assert.equal(p1.rows[0]?.is_active, true);
    const orgId = p1.rows[0].organization_id;

    const p2 = await db.query<{ role: string; is_active: boolean }>(
      `select role::text, is_active from user_profiles where id = $1`,
      [mgr1Id],
    );
    assert.equal(p2.rows[0]?.role, 'viewer');
    assert.equal(p2.rows[0]?.is_active, false);

    const signupNotifs = await db.query<{ kind: string }>(
      `select kind from notifications where user_id = $1 and kind = 'user_pending'`,
      [adminId],
    );
    assert.equal(signupNotifs.rows.length, 1);

    // Promote second user & add a delegated manager approver
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'head2@bpwi.test', $2::jsonb)`, [
      mgrApproverId,
      JSON.stringify({ full_name: 'Other Head' }),
    ]);
    await db.query(`update user_profiles set role = 'manager', is_active = true, can_approve = true where id in ($1, $2)`, [
      mgr1Id,
      mgrApproverId,
    ]);

    // Seed operators, shifts, areas across org 1 and a foreign org 2
    const op1Res = await db.query<{ id: string }>(
      `insert into operators (organization_id, full_name) values ($1, 'Op One') returning id`,
      [orgId],
    );
    const opId = op1Res.rows[0].id;

    const shift1Res = await db.query<{ id: string }>(
      `insert into shift_types (organization_id, code, duration_hours) values ($1, '7-4', 8) returning id`,
      [orgId],
    );
    const shift2Res = await db.query<{ id: string }>(
      `insert into shift_types (organization_id, code, duration_hours) values ($1, '10-7', 8) returning id`,
      [orgId],
    );
    const shift1Id = shift1Res.rows[0].id;
    const shift2Id = shift2Res.rows[0].id;

    const org2Res = await db.query<{ id: string }>(`insert into organizations (name) values ('Other Org') returning id`);
    const org2Id = org2Res.rows[0].id;
    const foreignOpRes = await db.query<{ id: string }>(
      `insert into operators (organization_id, full_name) values ($1, 'Foreign Op') returning id`,
      [org2Id],
    );
    const foreignOpId = foreignOpRes.rows[0].id;

    // 2. 020 Cross-org validation on change_request_items (plus 021 direct-insert guard)
    await setAuthUid(db, mgr1Id);
    await assert.rejects(
      () =>
        db.query(
          `insert into change_requests (organization_id, requester_id, title, status) values ($1, $2, 'Sneaky Preapproved', 'approved')`,
          [orgId, mgr1Id],
        ),
      /must start in draft or pending/i,
    );

    const reqCrossRes = await db.query<{ id: string }>(
      `insert into change_requests (organization_id, requester_id, title) values ($1, $2, 'Test Req') returning id`,
      [orgId, mgr1Id],
    );
    const reqId = reqCrossRes.rows[0].id;

    await assert.rejects(
      () =>
        db.query(
          `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, shift_type_id)
           values ($1, $2, 'schedule_assignments', 'upsert', $3, '2026-11-20', $4)`,
          [reqId, orgId, foreignOpId, shift1Id],
        ),
      /does not belong to this organization/i,
    );

    // Insert 2 valid schedule items into reqId
    const item1Res = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, shift_type_id, original_state)
       values ($1, $2, 'schedule_assignments', 'upsert', $3, '2026-11-20', $4, null) returning id`,
      [reqId, orgId, opId, shift1Id],
    );
    const item2Res = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, shift_type_id, original_state)
       values ($1, $2, 'schedule_assignments', 'upsert', $3, '2026-11-21', $4, null) returning id`,
      [reqId, orgId, opId, shift2Id],
    );
    const item1Id = item1Res.rows[0].id;
    const item2Id = item2Res.rows[0].id;

    await db.query(`select submit_change_request($1, 'Please review')`, [reqId]);

    // 3. 020 Pending -> Draft rollback + 021 direct table approval/title-tamper bypasses blocked for delegated approvers & admins
    await assert.rejects(
      () => db.query(`update change_requests set status = 'draft' where id = $1`, [reqId]),
      /cannot be moved back to draft/i,
    );
    await assert.rejects(
      () => db.query(`update change_requests set status = 'approved' where id = $1`, [reqId]),
      /only be changed through approve_change_request/i,
    );
    await assert.rejects(
      () => db.query(`update change_requests set title = 'Tampered Pending Title' where id = $1`, [reqId]),
      /Pending requests cannot be edited by the requester/i,
    );

    // Non-requester approver and admin also cannot directly flip status without RPC
    await setAuthUid(db, mgrApproverId);
    await assert.rejects(
      () => db.query(`update change_requests set status = 'approved' where id = $1`, [reqId]),
      /only be changed through approve_change_request/i,
    );
    await setAuthUid(db, adminId);
    await assert.rejects(
      () => db.query(`update change_requests set status = 'rejected' where id = $1`, [reqId]),
      /only be changed through approve_change_request/i,
    );
    await setAuthUid(db, mgr1Id);

    // 4. 020 No self-approval by delegated manager or by admin without p_allow_self_override
    await assert.rejects(
      () => db.query(`select approve_change_request($1, array[$2]::uuid[])`, [reqId, item1Id]),
      /cannot approve their own change requests/i,
    );

    // Create admin's own request to verify admin override flag
    await setAuthUid(db, adminId);
    const adminReqRes = await db.query<{ id: string }>(
      `insert into change_requests (organization_id, requester_id, title, status) values ($1, $2, 'Admin Req', 'draft') returning id`,
      [orgId, adminId],
    );
    const adminReqId = adminReqRes.rows[0].id;
    const adminItemRes = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, shift_type_id)
       values ($1, $2, 'schedule_assignments', 'upsert', $3, '2026-11-22', $4) returning id`,
      [adminReqId, orgId, opId, shift1Id],
    );
    await db.query(`select submit_change_request($1, null)`, [adminReqId]);
    await assert.rejects(
      () => db.query(`select approve_change_request($1, array[$2]::uuid[])`, [adminReqId, adminItemRes.rows[0].id]),
      /explicit admin override required/i,
    );
    await db.query(
      `select approve_change_request($1, array[$2]::uuid[], null, 'Self override', false, true)`,
      [adminReqId, adminItemRes.rows[0].id],
    );
    const adminReqAfter = await db.query<{ status: string }>(`select status from change_requests where id = $1`, [adminReqId]);
    assert.equal(adminReqAfter.rows[0]?.status, 'approved');

    // 5. 020 Partial approval keeps header partially_approved, notifies requester, allows follow-up to approved
    await setAuthUid(db, mgrApproverId);
    const partialRes = await db.query<{ res: { status: string; remaining_pending_count: number; approved_count: number } }>(
      `select approve_change_request($1, array[$2]::uuid[], null, 'Batch 1', false, false) as res`,
      [reqId, item1Id],
    );
    assert.equal(partialRes.rows[0].res.status, 'partially_approved');
    assert.equal(partialRes.rows[0].res.remaining_pending_count, 1);
    assert.equal(partialRes.rows[0].res.approved_count, 1);

    const partialNotif = await db.query<{ kind: string; title: string }>(
      `select kind, title from notifications where user_id = $1 and kind = 'request_partially_approved'`,
      [mgr1Id],
    );
    assert.equal(partialNotif.rows.length, 1);
    assert.equal(partialNotif.rows[0].title, 'Change Request Partially Approved');

    const fullRes = await db.query<{ res: { status: string; remaining_pending_count: number } }>(
      `select approve_change_request($1, array[$2]::uuid[], null, 'Batch 2', false, false) as res`,
      [reqId, item2Id],
    );
    assert.equal(fullRes.rows[0].res.status, 'approved');
    assert.equal(fullRes.rows[0].res.remaining_pending_count, 0);

    // 6. 020 reject_change_request blocked on already-approved request
    await assert.rejects(
      () => db.query(`select reject_change_request($1, 'Too late')`, [reqId]),
      /Cannot reject change request in approved status/i,
    );

    // 7. 020 Standby conflict + Leave update (no duplicate) + Leave overlap conflict
    await db.query(
      `insert into standby_assignments (organization_id, operator_id, schedule_date, standby_type) values ($1, $2, '2026-11-25', 'OC')`,
      [orgId, opId],
    );
    const leaveRowRes = await db.query<{ id: string }>(
      `insert into leave_records (organization_id, operator_id, leave_code, start_date, end_date) values ($1, $2, 'VL', '2026-12-01', '2026-12-02') returning id`,
      [orgId, opId],
    );
    const leaveId = leaveRowRes.rows[0].id;

    await setAuthUid(db, mgr1Id);
    const conflictReqRes = await db.query<{ id: string }>(
      `insert into change_requests (organization_id, requester_id, title) values ($1, $2, 'Conflict & Leave') returning id`,
      [orgId, mgr1Id],
    );
    const cReqId = conflictReqRes.rows[0].id;

    // Standby item saw 'OC' originally, we'll mutate live standby to 'DWP' before approval
    const sbItemRes = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, standby_type, original_state)
       values ($1, $2, 'standby_assignments', 'upsert', $3, '2026-11-25', 'ERP', '{"standby_type":"OC"}'::jsonb) returning id`,
      [cReqId, orgId, opId],
    );
    // Valid leave edit targeting existing leaveId (updating end_date 2026-12-02 -> 2026-12-03)
    const leaveEditItemRes = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, target_id, action, operator_id, schedule_date, leave_code, leave_start_date, leave_end_date, original_state)
       values ($1, $2, 'leave_records', $3, 'upsert', $4, '2026-12-01', 'VL', '2026-12-01', '2026-12-03', '{"leave_code":"VL","start_date":"2026-12-01","end_date":"2026-12-02"}'::jsonb) returning id`,
      [cReqId, orgId, leaveId, opId],
    );
    // Overlapping new leave insert (target_id = null, dates 2026-12-02..2026-12-04)
    const leaveOverlapItemRes = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, target_id, action, operator_id, schedule_date, leave_code, leave_start_date, leave_end_date, original_state)
       values ($1, $2, 'leave_records', null, 'upsert', $3, '2026-12-02', 'SL', '2026-12-02', '2026-12-04', null) returning id`,
      [cReqId, orgId, opId],
    );

    await db.query(`select submit_change_request($1, null)`, [cReqId]);

    // Concurrent edit to standby_assignments before approval
    await db.query(
      `update standby_assignments set standby_type = 'DWP' where organization_id = $1 and operator_id = $2 and schedule_date = '2026-11-25'`,
      [orgId, opId],
    );

    await setAuthUid(db, mgrApproverId);
    const conflictApproveRes = await db.query<{ res: { approved_count: number; conflict_count: number } }>(
      `select approve_change_request($1, array[$2, $3, $4]::uuid[], null, null, false, false) as res`,
      [cReqId, sbItemRes.rows[0].id, leaveEditItemRes.rows[0].id, leaveOverlapItemRes.rows[0].id],
    );

    assert.equal(conflictApproveRes.rows[0].res.approved_count, 1); // Only leaveEditItem succeeded
    assert.equal(conflictApproveRes.rows[0].res.conflict_count, 2); // sbItem + leaveOverlapItem conflicted

    const sbLive = await db.query<{ standby_type: string }>(
      `select standby_type from standby_assignments where operator_id = $1 and schedule_date = '2026-11-25'`,
      [opId],
    );
    assert.equal(sbLive.rows[0]?.standby_type, 'DWP'); // Live standby preserved, not blindly overwritten

    const leavesLive = await db.query<{ id: string; end_date: string }>(
      `select id, end_date::text from leave_records where operator_id = $1`,
      [opId],
    );
    assert.equal(leavesLive.rows.length, 1); // Updated in place, no duplicate!
    assert.equal(leavesLive.rows[0].id, leaveId);
    assert.equal(leavesLive.rows[0].end_date, '2026-12-03');

    // 8. 021 RLS policies lock out direct approver updates on change_requests and change_request_items
    const crPolicies = await db.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
      `select tablename::text, policyname::text, qual, with_check
       from pg_policies
       where schemaname = 'public'
         and tablename in ('change_requests', 'change_request_items')
         and policyname in ('change_requests update', 'change_request_items update')`,
    );
    assert.equal(crPolicies.rows.length, 2);
    for (const pol of crPolicies.rows) {
      assert.ok(!(pol.qual ?? '').includes('is_approver'), `${pol.policyname} qual should not allow is_approver`);
      assert.ok(!(pol.with_check ?? '').includes('is_approver'), `${pol.policyname} with_check should not allow is_approver`);
    }

    // 9. 021 activity-media storage bucket is private with org-scoped read policy
    const bucketRes = await db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'activity-media'`,
    );
    assert.equal(bucketRes.rows[0]?.public, false);

    const storagePols = await db.query<{ policyname: string }>(
      `select policyname::text from pg_policies where schemaname = 'storage' and tablename = 'objects'`,
    );
    const storagePolNames = storagePols.rows.map((r) => r.policyname);
    assert.ok(!storagePolNames.includes('activity-media public read'));
    assert.ok(storagePolNames.includes('activity-media org read'));

    // 10. 021 seed_bpwi_iloilo_org_chart is admin-only, revoked from public/anon, and name-free
    const privRes = await db.query<{ pub: boolean; anon: boolean; auth: boolean }>(
      `select
         has_function_privilege('public', 'seed_bpwi_iloilo_org_chart(uuid)', 'EXECUTE') as pub,
         has_function_privilege('anon', 'seed_bpwi_iloilo_org_chart(uuid)', 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'seed_bpwi_iloilo_org_chart(uuid)', 'EXECUTE') as auth`,
    );
    assert.equal(privRes.rows[0]?.pub, false);
    assert.equal(privRes.rows[0]?.anon, false);
    assert.equal(privRes.rows[0]?.auth, true);

    await setAuthUid(db, mgr1Id);
    await assert.rejects(
      () => db.query(`select seed_bpwi_iloilo_org_chart($1)`, [orgId]),
      /only organization admins/i,
    );

    await setAuthUid(db, adminId);
    await assert.rejects(
      () => db.query(`select seed_bpwi_iloilo_org_chart($1)`, [org2Id]),
      /only organization admins/i,
    );

    await db.query(`delete from org_positions where organization_id = $1`, [orgId]);
    await db.query(`select seed_bpwi_iloilo_org_chart($1)`, [orgId]);
    const seededRes = await db.query<{ total: number; named: number; vacant: number }>(
      `select
         count(*)::int as total,
         count(*) filter (where fallback_name is not null)::int as named,
         count(*) filter (where is_vacant = true)::int as vacant
       from org_positions
       where organization_id = $1`,
      [orgId],
    );
    assert.ok(seededRes.rows[0].total >= 20);
    assert.equal(seededRes.rows[0].named, 0);
    assert.equal(seededRes.rows[0].vacant, seededRes.rows[0].total);

    // 11. 022 Consolidate 6 station codes (PW, RM, LD, MR, WM, WD) -> 3 (PL, FD, WD) idempotently & admin-only
    await setAuthUid(db, mgr1Id);
    await assert.rejects(
      () => db.query(`select consolidate_station_codes_for_org($1)`, [orgId]),
      /only organization admins/i,
    );

    await setAuthUid(db, adminId);
    await assert.rejects(
      () => db.query(`select consolidate_station_codes_for_org($1)`, [org2Id]),
      /only organization admins/i,
    );

    const pwRes = await db.query<{ id: string }>(
      `insert into area_codes (organization_id, code, name, category) values ($1, 'PW', 'Plant Works', 'station') returning id`,
      [orgId],
    );
    const rmRes = await db.query<{ id: string }>(
      `insert into area_codes (organization_id, code, name, category, sub_sites) values ($1, 'RM', 'Repair & Maintenance', 'station', array['Pump A', 'Valve 1']) returning id`,
      [orgId],
    );
    const ldRes = await db.query<{ id: string }>(
      `insert into area_codes (organization_id, code, name, category, sub_sites) values ($1, 'LD', 'Leak Detection', 'station', array['Zone 1', 'Valve 1']) returning id`,
      [orgId],
    );
    const mrRes = await db.query<{ id: string }>(
      `insert into area_codes (organization_id, code, name, category) values ($1, 'MR', 'Meter Reading', 'station') returning id`,
      [orgId],
    );
    const wmRes = await db.query<{ id: string }>(
      `insert into area_codes (organization_id, code, name, category) values ($1, 'WM', 'Well Monitoring', 'station') returning id`,
      [orgId],
    );
    await db.query(
      `insert into area_codes (organization_id, code, name, category) values
       ($1, 'WD', 'Water Delivery', 'station'),
       ($1, 'RD', 'Rest Day', 'rest'),
       ($1, 'AL', 'Annual Leave', 'leave')`,
      [orgId],
    );

    const pwId = pwRes.rows[0].id;
    const rmId = rmRes.rows[0].id;
    const ldId = ldRes.rows[0].id;
    const mrId = mrRes.rows[0].id;
    const wmId = wmRes.rows[0].id;

    await db.query(
      `insert into operators (organization_id, full_name, default_station) values
       ($1, 'Legacy PW Op', 'PW'),
       ($1, 'Legacy RM Op', 'RM'),
       ($1, 'Legacy LD Op', 'LD')`,
      [orgId],
    );

    await db.query(
      `insert into schedule_assignments (organization_id, operator_id, schedule_date, shift_type_id, area_code_id) values
       ($1, $2, '2026-12-10', $3, $4),
       ($1, $2, '2026-12-11', $3, $5)`,
      [orgId, opId, shift1Id, pwId, rmId],
    );
    const actRes = await db.query<{ id: string }>(
      `insert into daily_activities (organization_id, lead_operator_id, area_code_id, activity_type) values ($1, $2, $3, 'leak_detection') returning id`,
      [orgId, opId, ldId],
    );
    const joRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, area_code_id) values ($1, 'JO-TEST-001', 'Meter Check', $2) returning id`,
      [orgId, mrId],
    );
    const hoRes = await db.query<{ id: string }>(
      `insert into shift_handovers (organization_id, area_code_id, summary) values ($1, $2, 'Well check complete') returning id`,
      [orgId, wmId],
    );
    const crRes = await db.query<{ id: string }>(
      `insert into change_requests (organization_id, requester_id, title, status) values ($1, $2, 'Legacy Area Req', 'draft') returning id`,
      [orgId, adminId],
    );
    const criRes = await db.query<{ id: string }>(
      `insert into change_request_items (request_id, organization_id, target_table, action, operator_id, schedule_date, shift_type_id, area_code_id, original_state)
       values ($1, $2, 'schedule_assignments', 'upsert', $3, '2026-12-12', $4, $5, $6::jsonb) returning id`,
      [crRes.rows[0].id, orgId, opId, shift1Id, rmId, JSON.stringify({ shift_type_id: shift1Id, area_code_id: pwId })],
    );

    // Run consolidation twice to assert idempotency
    await db.query(`select consolidate_station_codes_for_org($1)`, [orgId]);
    await db.query(`select consolidate_station_codes_for_org($1)`, [orgId]);

    // 022 safety net: retired codes are archived and every rewritten row records old -> new area id
    const archived = await db.query<{ code: string }>(
      `select original->>'code' as code from area_code_archive where organization_id = $1 and original ? 'code' order by 1`,
      [orgId],
    );
    assert.deepEqual(archived.rows.map((r) => r.code), ['LD', 'MR', 'PW', 'RM', 'WM'].filter((c) => archived.rows.some((r) => r.code === c)));
    assert.ok(archived.rows.some((r) => r.code === 'PW') && archived.rows.some((r) => r.code === 'RM'));
    const remapped = await db.query<{ n: number }>(
      `select count(*)::int as n from area_code_remap where organization_id = $1 and source_table = 'schedule_assignments'`,
      [orgId],
    );
    assert.ok(remapped.rows[0].n >= 1);
    // second (idempotent) run must not duplicate the archive
    const archivedAgain = await db.query<{ n: number }>(`select count(*)::int as n from area_code_archive where organization_id = $1 and original ? 'code'`, [orgId]);
    assert.equal(archivedAgain.rows[0].n, archived.rows.length);

    const postAreas = await db.query<{ id: string; code: string; name: string; category: string; sub_sites: string[] }>(
      `select id, code, name, category, sub_sites from area_codes where organization_id = $1 order by category, code`,
      [orgId],
    );
    const stationAreas = postAreas.rows.filter((a) => a.category === 'station');
    assert.deepEqual(
      stationAreas.map((a) => a.code),
      ['FD', 'PL', 'WD'],
    );
    assert.deepEqual(
      postAreas.rows.filter((a) => a.category !== 'station').map((a) => a.code),
      ['AL', 'RD'],
    );

    const plArea = stationAreas.find((a) => a.code === 'PL')!;
    const fdArea = stationAreas.find((a) => a.code === 'FD')!;
    assert.equal(plArea.name, 'Plant Operations');
    assert.equal(fdArea.name, 'Field Operations');
    assert.deepEqual(fdArea.sub_sites, ['Pump A', 'Valve 1', 'Zone 1']);

    const postAsgs = await db.query<{ schedule_date: string; area_code_id: string }>(
      `select schedule_date::text, area_code_id from schedule_assignments where operator_id = $1 and schedule_date in ('2026-12-10', '2026-12-11') order by schedule_date`,
      [opId],
    );
    assert.equal(postAsgs.rows[0]?.area_code_id, plArea.id);
    assert.equal(postAsgs.rows[1]?.area_code_id, fdArea.id);

    const postAct = await db.query<{ area_code_id: string }>(`select area_code_id from daily_activities where id = $1`, [actRes.rows[0].id]);
    const postJo = await db.query<{ area_code_id: string }>(`select area_code_id from job_orders where id = $1`, [joRes.rows[0].id]);
    const postHo = await db.query<{ area_code_id: string }>(`select area_code_id from shift_handovers where id = $1`, [hoRes.rows[0].id]);
    const postCri = await db.query<{ area_code_id: string; orig_area: string }>(
      `select area_code_id, original_state->>'area_code_id' as orig_area from change_request_items where id = $1`,
      [criRes.rows[0].id],
    );
    assert.equal(postAct.rows[0]?.area_code_id, fdArea.id);
    assert.equal(postJo.rows[0]?.area_code_id, fdArea.id);
    assert.equal(postHo.rows[0]?.area_code_id, fdArea.id);
    assert.equal(postCri.rows[0]?.area_code_id, fdArea.id);
    assert.equal(postCri.rows[0]?.orig_area, plArea.id);

    const postOps = await db.query<{ full_name: string; default_station: string }>(
      `select full_name, default_station from operators where organization_id = $1 and full_name like 'Legacy %' order by full_name`,
      [orgId],
    );
    assert.deepEqual(postOps.rows, [
      { full_name: 'Legacy LD Op', default_station: 'FD' },
      { full_name: 'Legacy PW Op', default_station: 'PL' },
      { full_name: 'Legacy RM Op', default_station: 'FD' },
    ]);

    // 12. 024–025 PM actual performers: unlisted active operator can close open task as done
    //     ONLY when crediting themselves; done tasks cannot be reopened or modified by operators.
    const pmPolicy = await db.query<{ qual: string | null; with_check: string | null }>(
      `select qual, with_check from pg_policies where schemaname = 'public' and tablename = 'pm_tasks' and policyname = 'pm_tasks operator close'`,
    );
    assert.equal(pmPolicy.rows.length, 1);
    assert.ok(!(pmPolicy.rows[0].qual ?? '').includes('assigned_operator_ids'));
    assert.match(pmPolicy.rows[0].qual ?? '', /done/i);
    assert.match(pmPolicy.rows[0].with_check ?? '', /completed_by_operator_ids/);
    assert.match(pmPolicy.rows[0].with_check ?? '', /assigned_operator_ids/);

    await db.exec(`
      grant usage on schema public to authenticated;
      grant select, update on pm_tasks to authenticated;
      grant execute on function current_org(), current_role_name(), current_operator_id() to authenticated;
    `);

    const subUserId = '44444444-4444-4444-8444-444444444444';
    const assignedUserId = '55555555-5555-4555-8555-555555555555';
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'subop@bpwi.test', $2::jsonb, $3::jsonb)`,
      [subUserId, JSON.stringify({ full_name: 'Substitute Op' }), JSON.stringify({ organization_id: orgId })],
    );
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'assignedop@bpwi.test', $2::jsonb, $3::jsonb)`,
      [assignedUserId, JSON.stringify({ full_name: 'Op One' }), JSON.stringify({ organization_id: orgId })],
    );
    const subOpRes = await db.query<{ id: string }>(
      `insert into operators (organization_id, full_name) values ($1, 'Substitute Op') returning id`,
      [orgId],
    );
    const subOpId = subOpRes.rows[0].id;
    await db.query(`update user_profiles set role = 'operator', is_active = true, operator_id = $2 where id = $1`, [
      subUserId,
      subOpId,
    ]);
    await db.query(`update user_profiles set role = 'operator', is_active = true, operator_id = $2 where id = $1`, [
      assignedUserId,
      opId,
    ]);

    await setAuthUid(db, adminId);
    const pmTaskRes = await db.query<{ id: string }>(
      `insert into pm_tasks (organization_id, activity_type, title, scheduled_date, assigned_operator_ids, status)
       values ($1, 'FLUSH', 'Line Flushing', '2026-12-15', array[$2]::uuid[], 'planned') returning id`,
      [orgId, opId],
    );
    const pmTaskId = pmTaskRes.rows[0].id;

    // 12a. Assigned operator CAN update open task status (planned -> postponed -> planned) under ROLE authenticated
    await setAuthUid(db, assignedUserId);
    await db.exec('begin; set local role authenticated;');
    const postponed = await db.query<{ status: string }>(
      `update pm_tasks set status = 'postponed', completed_by_operator_ids = '{}' where id = $1 returning status::text`,
      [pmTaskId],
    );
    assert.equal(postponed.rowCount, 1);
    assert.equal(postponed.rows[0]?.status, 'postponed');
    const replanned = await db.query<{ status: string }>(
      `update pm_tasks set status = 'planned', completed_by_operator_ids = '{}' where id = $1 returning status::text`,
      [pmTaskId],
    );
    assert.equal(replanned.rowCount, 1);
    await db.exec('commit;');

    // 12b. Unlisted substitute CANNOT postpone open task (RLS blocks + trigger blocks)
    await setAuthUid(db, subUserId);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () => db.query(`update pm_tasks set status = 'postponed' where id = $1`, [pmTaskId]),
      /Unlisted operators may only close open PM tasks as done|row-level security policy/i,
    );
    await db.exec('rollback;');

    // 12c. Unlisted substitute CANNOT close open task without including themselves in completed_by_operator_ids
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () =>
        db.query(
          `update pm_tasks set status = 'done', completed_at = '2026-12-15', completed_by_operator_ids = array[$2]::uuid[] where id = $1`,
          [pmTaskId, opId],
        ),
      /must be included in completed_by_operator_ids|row-level security policy/i,
    );
    await db.exec('rollback;');

    // 12d. Unlisted substitute CAN close open task as 'done' when including themselves in completed_by_operator_ids
    await db.exec('begin; set local role authenticated;');
    const subClose = await db.query<{ id: string }>(
      `update pm_tasks
       set status = 'done', completed_at = '2026-12-15', remarks = 'Covered by substitute', completed_by_operator_ids = array[$2]::uuid[]
       where id = $1 returning id`,
      [pmTaskId, subOpId],
    );
    assert.equal(subClose.rowCount, 1);
    await db.exec('commit;');

    const updatedPm = await db.query<{ assigned: string[]; performed: string[]; status: string }>(
      `select assigned_operator_ids as assigned, completed_by_operator_ids as performed, status::text from pm_tasks where id = $1`,
      [pmTaskId],
    );
    assert.equal(updatedPm.rows[0]?.status, 'done');
    assert.deepEqual(updatedPm.rows[0]?.assigned, [opId]);
    assert.deepEqual(updatedPm.rows[0]?.performed, [subOpId]);

    // 12e. Neither substitute nor planned assignee can reopen a done task or edit performers under ROLE authenticated (0 rows via USING) or trigger
    await db.exec('begin; set local role authenticated;');
    const subReopenRls = await db.query<{ id: string }>(
      `update pm_tasks set status = 'planned', completed_by_operator_ids = '{}' where id = $1 returning id`,
      [pmTaskId],
    );
    assert.equal(subReopenRls.rowCount, 0);
    await db.exec('rollback;');

    await setAuthUid(db, assignedUserId);
    await db.exec('begin; set local role authenticated;');
    const assigneeReopenRls = await db.query<{ id: string }>(
      `update pm_tasks set status = 'planned', completed_by_operator_ids = '{}' where id = $1 returning id`,
      [pmTaskId],
    );
    assert.equal(assigneeReopenRls.rowCount, 0);
    await db.exec('rollback;');

    await assert.rejects(
      () => db.query(`update pm_tasks set status = 'planned', completed_by_operator_ids = '{}' where id = $1`, [pmTaskId]),
      /Operators cannot reopen or modify completed PM tasks/i,
    );
    await assert.rejects(
      () => db.query(`update pm_tasks set completed_by_operator_ids = array[$2]::uuid[] where id = $1`, [pmTaskId, opId]),
      /Operators cannot reopen or modify completed PM tasks/i,
    );

    // 12f. Operator cannot tamper with planned assigned_operator_ids or insert cross-org performers
    await setAuthUid(db, subUserId);
    await assert.rejects(
      () => db.query(`update pm_tasks set assigned_operator_ids = array[$2]::uuid[] where id = $1`, [pmTaskId, subOpId]),
      /may only update status, completed_at, remarks, and completed_by_operator_ids/i,
    );
    await assert.rejects(
      () => db.query(`update pm_tasks set completed_by_operator_ids = array[$2]::uuid[] where id = $1`, [pmTaskId, foreignOpId]),
      /does not belong to this organization/i,
    );

    // 12g. Admin CAN still reopen a completed task and adjust actual performers
    await setAuthUid(db, adminId);
    await db.query(`update pm_tasks set status = 'planned', completed_at = null, completed_by_operator_ids = '{}' where id = $1`, [
      pmTaskId,
    ]);
    const adminReopened = await db.query<{ status: string }>(`select status::text from pm_tasks where id = $1`, [pmTaskId]);
    assert.equal(adminReopened.rows[0]?.status, 'planned');

    // 13. 027 PM Locations catalog: backfill, case-insensitive uniqueness & operator read-only RLS
    await db.query(
      `update pm_tasks set locations = array['Pavia Plant', 'Custom Site X'] where id = $1`,
      [pmTaskId],
    );
    const sql27 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_pm_locations.sql'), 'utf8');
    await db.exec(sql27);

    const backfilled = await db.query<{ name: string }>(
      `select name from pm_locations where organization_id = $1 order by name`,
      [orgId],
    );
    assert.deepEqual(
      backfilled.rows.map((r) => r.name),
      ['Custom Site X', 'Pavia Plant', 'Pump A', 'Valve 1', 'Zone 1'],
    );

    // Case-insensitive unique index prevents duplicate casing
    await assert.rejects(
      () => db.query(`insert into pm_locations (organization_id, name) values ($1, '  pavia plant  ')`, [orgId]),
      /duplicate key|pm_locations_org_name_lower_uidx/i,
    );

    // Operator can read org pm_locations, but cannot insert or delete
    await setAuthUid(db, subUserId);
    await db.exec('begin; set local role authenticated;');
    const opReadLocs = await db.query<{ name: string }>(
      `select name from pm_locations where organization_id = $1`,
      [orgId],
    );
    assert.equal(opReadLocs.rowCount, 5);
    await assert.rejects(
      () => db.query(`insert into pm_locations (organization_id, name) values ($1, 'Unauthorized Site')`, [orgId]),
      /row-level security policy/i,
    );
    await db.exec('rollback;');

    // Admin can insert and delete saved PM locations
    await setAuthUid(db, adminId);
    await db.exec('begin; set local role authenticated;');
    const adminIns = await db.query<{ id: string }>(
      `insert into pm_locations (organization_id, name, sort_order) values ($1, 'Wakeboard Plant', 10) returning id`,
      [orgId],
    );
    assert.equal(adminIns.rowCount, 1);
    const adminDel = await db.query(
      `delete from pm_locations where id = $1`,
      [adminIns.rows[0].id],
    );
    assert.equal(adminDel.rowCount, 1);
    await db.exec('commit;');

    // 14. 028 Shared route compute cache/rate-limit RPCs & PM substitute colleague-credit guard
    const colleagueOpRes = await db.query<{ id: string }>(
      `insert into operators (organization_id, full_name) values ($1, 'Unrelated Colleague') returning id`,
      [orgId],
    );
    const colleagueOpId = colleagueOpRes.rows[0].id;

    // Reset pmTaskId open with opId as planned assignee
    await db.query(
      `update pm_tasks set status = 'planned', completed_at = null, completed_by_operator_ids = '{}' where id = $1`,
      [pmTaskId],
    );

    // 14a. Substitute operator closing open task CANNOT credit an unrelated unlisted colleague
    await setAuthUid(db, subUserId);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () =>
        db.query(
          `update pm_tasks set status = 'done', completed_at = '2026-12-15', completed_by_operator_ids = array[$2, $3]::uuid[] where id = $1`,
          [pmTaskId, subOpId, colleagueOpId],
        ),
      /only credit themselves and the originally assigned operators|row-level security policy/i,
    );
    await db.exec('rollback;');

    // 14b. Substitute operator CAN close crediting self + originally assigned operator
    await db.exec('begin; set local role authenticated;');
    const subPlusPlanned = await db.query<{ id: string }>(
      `update pm_tasks set status = 'done', completed_at = '2026-12-15', completed_by_operator_ids = array[$2, $3]::uuid[] where id = $1 returning id`,
      [pmTaskId, subOpId, opId],
    );
    assert.equal(subPlusPlanned.rowCount, 1);
    await db.exec('commit;');

    // 14c. Admin can still reset & credit any org operator
    await setAuthUid(db, adminId);
    await db.query(
      `update pm_tasks set status = 'done', completed_at = '2026-12-15', completed_by_operator_ids = array[$2]::uuid[] where id = $1`,
      [pmTaskId, colleagueOpId],
    );

    // 14d. 029 Hardening: authenticated users CANNOT execute any route cache/rate-limit RPCs or access raw tables
    await setAuthUid(db, subUserId);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () => db.query(`select * from check_route_compute_rate_limit($1::uuid, 'upstream')`, [subUserId]),
      /permission denied/i,
    );
    await db.exec('rollback;');

    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () =>
        db.query(`select set_route_compute_cache($1::uuid, 'poison-key', '[]'::jsonb, '[]'::jsonb)`, [orgId]),
      /permission denied/i,
    );
    await db.exec('rollback;');

    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () => db.query(`select * from get_route_compute_cache($1::uuid, 'k-test-1')`, [orgId]),
      /permission denied/i,
    );
    await db.exec('rollback;');

    await db.exec('begin; set local role authenticated;');
    await assert.rejects(() => db.query(`select * from route_compute_cache`), /permission denied/i);
    await db.exec('rollback;');

    await db.exec('begin; set local role authenticated;');
    await assert.rejects(() => db.query(`select * from route_compute_rate_hits`), /permission denied/i);
    await db.exec('rollback;');

    // 14e. 029 Hardening: service_role enforces org-isolated cache, size caps, fixed rate limits, and periodic cleanup
    await setAuthUid(db, null);
    await db.exec('begin; set local role service_role;');
    await db.query(
      `select set_route_compute_cache($1::uuid, 'k-test-1', $2::jsonb, $3::jsonb)`,
      [orgId, JSON.stringify([{ distanceMeters: 1200, durationSeconds: 95 }]), JSON.stringify(['abcPolyline'])],
    );

    // Org 2 cannot see Org 1's cached route even with identical cache_key
    const crossOrgCache = await db.query(
      `select * from get_route_compute_cache($1::uuid, 'k-test-1')`,
      [org2Id],
    );
    assert.equal(crossOrgCache.rowCount, 0);

    const ownOrgCache = await db.query<{
      routed_legs: Array<{ distanceMeters: number; durationSeconds: number }>;
      encoded_polylines: string[];
    }>(`select * from get_route_compute_cache($1::uuid, 'k-test-1')`, [orgId]);
    assert.deepEqual(ownOrgCache.rows[0]?.routed_legs, [{ distanceMeters: 1200, durationSeconds: 95 }]);
    assert.deepEqual(ownOrgCache.rows[0]?.encoded_polylines, ['abcPolyline']);

    // Fixed upstream limit (20 per 5 min) cannot be overridden by caller
    for (let i = 0; i < 20; i += 1) {
      const okHit = await db.query<{ allowed: boolean; remaining: number }>(
        `select * from check_route_compute_rate_limit($1::uuid, 'upstream')`,
        [subUserId],
      );
      assert.equal(okHit.rows[0]?.allowed, true);
      assert.equal(okHit.rows[0]?.remaining, 19 - i);
    }
    const blocked21st = await db.query<{ allowed: boolean; remaining: number; retry_after_seconds: number }>(
      `select * from check_route_compute_rate_limit($1::uuid, 'upstream')`,
      [subUserId],
    );
    assert.equal(blocked21st.rows[0]?.allowed, false);
    assert.ok((blocked21st.rows[0]?.retry_after_seconds ?? 0) >= 1);
    await db.exec('commit;');

    // Payload element/byte caps reject oversized route arrays
    const oversizedLegs = JSON.stringify(
      Array.from({ length: 65 }, () => ({ distanceMeters: 100, durationSeconds: 10 })),
    );
    await db.exec('begin; set local role service_role;');
    await assert.rejects(
      () => db.query(`select set_route_compute_cache($1::uuid, 'oversized', $2::jsonb, '[]'::jsonb)`, [orgId, oversizedLegs]),
      /exceeds size or element bounds/i,
    );
    await db.exec('rollback;');

    // Periodic cleanup sweeps stale hits from inactive users and expired cache rows
    await db.query(
      `insert into route_compute_rate_hits (user_id, bucket, created_at) values ($1, 'total', now() - interval '10 minutes')`,
      [mgr1Id],
    );
    await db.query(
      `insert into route_compute_cache (organization_id, cache_key, routed_legs, encoded_polylines, expires_at)
       values ($1, 'expired-key', '[]'::jsonb, '[]'::jsonb, now() - interval '1 minute')`,
      [orgId],
    );
    await db.exec('begin; set local role service_role;');
    const sweepRes = await db.query<{ purged_cache_rows: number; purged_rate_hits: number }>(
      `select * from purge_expired_route_compute_state()`,
    );
    assert.equal(sweepRes.rows[0]?.purged_cache_rows, 1);
    assert.equal(sweepRes.rows[0]?.purged_rate_hits, 1);
    await db.exec('commit;');

    // Re-running 029 migration is idempotent
    const sql29 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_harden_route_compute_store.sql'), 'utf8');
    await db.exec(sql29);

    // 15. 030 Sign-up lockdown & user_profiles audit trigger + 031 audit_logs org scoping
    await setAuthUid(db, adminId);
    await db.query(`update user_profiles set role = 'scheduler', can_approve = true where id = $1`, [mgr1Id]);
    const profAudit = await db.query<{
      organization_id: string | null;
      action: string;
      old_role: string;
      new_role: string;
      new_can_approve: boolean;
    }>(
      `select organization_id, action, old_value->>'role' as old_role, new_value->>'role' as new_role, (new_value->>'can_approve')::boolean as new_can_approve
       from audit_logs
       where table_name = 'user_profiles' and record_id = $1 and action = 'UPDATE'
       order by id desc limit 1`,
      [mgr1Id],
    );
    assert.equal(profAudit.rows[0]?.organization_id, orgId);
    assert.equal(profAudit.rows[0]?.action, 'UPDATE');
    assert.equal(profAudit.rows[0]?.old_role, 'manager');
    assert.equal(profAudit.rows[0]?.new_role, 'scheduler');
    assert.equal(profAudit.rows[0]?.new_can_approve, true);

    // Multi-org: uninvited user creation fails instead of defaulting to org limit 1
    const uninvitedId = '66666666-6666-4666-8666-666666666666';
    await assert.rejects(
      () =>
        db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'stray@example.com', '{}'::jsonb)`, [
          uninvitedId,
        ]),
      /Multiple organizations exist; new users must be invited with an organization_id/i,
    );

    // Multi-org: invited user creation routes into the invited organization as inactive viewer
    const invitedId = '77777777-7777-4777-8777-777777777777';
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'invited@org2.test', $2::jsonb, $3::jsonb)`,
      [invitedId, JSON.stringify({ full_name: 'Invited User' }), JSON.stringify({ organization_id: org2Id })],
    );
    const invitedProf = await db.query<{ organization_id: string; role: string; is_active: boolean }>(
      `select organization_id, role::text, is_active from user_profiles where id = $1`,
      [invitedId],
    );
    assert.deepEqual(invitedProf.rows[0], { organization_id: org2Id, role: 'viewer', is_active: false });

    // 031: Promote invited user to admin of org2 (creates org2 audit_logs row) & verify cross-org audit_logs RLS isolation
    await db.query(`update user_profiles set role = 'admin', is_active = true where id = $1`, [invitedId]);

    await setAuthUid(db, invitedId);
    await db.exec('begin; set local role authenticated;');
    const org2SeesOrg1Audit = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_logs where organization_id = $1`,
      [orgId],
    );
    const org2SeesOwnAudit = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_logs where organization_id = $1`,
      [org2Id],
    );
    await db.exec('commit;');
    assert.equal(org2SeesOrg1Audit.rows[0]?.cnt, 0);
    assert.ok((org2SeesOwnAudit.rows[0]?.cnt ?? 0) >= 1);

    await setAuthUid(db, adminId);
    await db.exec('begin; set local role authenticated;');
    const org1SeesOrg2Audit = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_logs where organization_id = $1`,
      [org2Id],
    );
    const org1SeesOwnAudit = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_logs where organization_id = $1`,
      [orgId],
    );
    await db.exec('commit;');
    assert.equal(org1SeesOrg2Audit.rows[0]?.cnt, 0);
    assert.ok((org1SeesOwnAudit.rows[0]?.cnt ?? 0) >= 1);

    // Re-running 031 migration is idempotent
    const sql31 = fs.readFileSync(path.join(MIGRATIONS_DIR, '031_scope_audit_logs_and_signup_controls.sql'), 'utf8');
    await db.exec(sql31);

    // Single-org email domain allowlist enforcement
    await db.query(`delete from organizations where id = $1`, [org2Id]);
    await db.query(`update organizations set allowed_signup_domains = array['bpwaterworks.com'] where id = $1`, [orgId]);

    const badDomainId = '88888888-8888-4888-8888-888888888888';
    await assert.rejects(
      () =>
        db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'outsider@gmail.com', '{}'::jsonb)`, [
          badDomainId,
        ]),
      /Sign-up restricted to approved email domains/i,
    );

    const goodDomainId = '99999999-9999-4999-8999-999999999999';
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'staff@bpwaterworks.com', $2::jsonb)`,
      [goodDomainId, JSON.stringify({ full_name: 'Approved Domain User' })],
    );
    const goodProf = await db.query<{ organization_id: string; role: string; is_active: boolean }>(
      `select organization_id, role::text, is_active from user_profiles where id = $1`,
      [goodDomainId],
    );
    assert.deepEqual(goodProf.rows[0], { organization_id: orgId, role: 'viewer', is_active: false });

    // Re-running 032 migration is idempotent
    const sql32 = fs.readFileSync(path.join(MIGRATIONS_DIR, '032_lock_down_first_admin_bootstrap.sql'), 'utf8');
    await db.exec(sql32);
  });
});
