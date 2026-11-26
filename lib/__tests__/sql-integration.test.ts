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
      name text,
      owner uuid default auth.uid()
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

describe('PGlite SQL migrations (all) execution & security invariants', () => {
  it('executes every migration cleanly and enforces sign-up, sample-log, department-head, change-request, storage, org-seed, station-code, PM credit, PM locations, route store, and audit invariants', async () => {
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

    // 16. 033 Genset registry: single active genset per location & transfer logging
    await setAuthUid(db, adminId);
    const gs1Res = await db.query<{ id: string }>(
      `insert into gensets (organization_id, control_no, kva_rating, status, current_location)
       values ($1, 'GS-01', '100 kVA', 'active', 'Well 4 BAR') returning id`,
      [orgId],
    );
    const gs1Id = gs1Res.rows[0].id;

    // Duplicate active genset on same normalized site fails via gensets_org_active_location_uidx
    await assert.rejects(
      () =>
        db.query(
          `insert into gensets (organization_id, control_no, status, current_location)
           values ($1, 'GS-02', 'active', '  well 4 bar ')`,
          [orgId],
        ),
      /gensets_org_active_location_uidx|duplicate key/i,
    );

    // Relocating GS-01 logs transfer history and frees Well 4 BAR for GS-02
    await db.query(`update gensets set current_location = 'Well 6 PR2' where id = $1`, [gs1Id]);
    const trRes = await db.query<{ from_location: string; to_location: string }>(
      `select from_location, to_location from genset_transfers where genset_id = $1`,
      [gs1Id],
    );
    assert.deepEqual(trRes.rows[0], { from_location: 'Well 4 BAR', to_location: 'Well 6 PR2' });

    await db.query(
      `insert into gensets (organization_id, control_no, status, current_location)
       values ($1, 'GS-02', 'active', 'Well 4 BAR')`,
      [orgId],
    );

    const sql33 = fs.readFileSync(path.join(MIGRATIONS_DIR, '033_genset_registry.sql'), 'utf8');
    await db.exec(sql33);

    // 17. 034 24h auto-expiring sample logs across all 4 tables
    // Re-apply 034 so its sample-skipping log_audit() is active after line 1034's 031 idempotency re-run
    const sql34 = fs.readFileSync(path.join(MIGRATIONS_DIR, '034_sample_logs.sql'), 'utf8');
    await db.exec(sql34);
    // Restore mgr1Id to 'manager' (line 960 flipped it to 'scheduler' for the user_profiles audit test)
    await setAuthUid(db, adminId);
    await db.query(`update user_profiles set role = 'manager' where id = $1`, [mgr1Id]);
    // Manager non-sample daily_activities insert must be denied; manager sample insert succeeds
    await setAuthUid(db, mgr1Id);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(
      () =>
        db.query(
          `insert into daily_activities (organization_id, logged_by, activity_type, is_sample)
           values ($1, $2, 'pump_monitoring', false)`,
          [orgId, mgr1Id],
        ),
      /row-level security/i,
    );
    await db.exec('rollback;');

    await db.exec('begin; set local role authenticated;');
    const sampleActRes = await db.query<{ id: string; is_sample: boolean; sample_expires_at: string | null }>(
      `insert into daily_activities (organization_id, logged_by, activity_type, is_sample)
       values ($1, $2, 'pump_monitoring', true)
       returning id, is_sample, sample_expires_at::text`,
      [orgId, mgr1Id],
    );
    await db.exec('commit;');
    const sampleActId = sampleActRes.rows[0].id;
    assert.equal(sampleActRes.rows[0].is_sample, true);
    assert.ok(sampleActRes.rows[0].sample_expires_at);

    // Sample row must NOT create audit_logs rows
    const sampleAudit = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from audit_logs where record_id = $1`,
      [sampleActId],
    );
    assert.equal(sampleAudit.rows[0]?.cnt, 0);

    // Immutable sample flag/expiry on update
    await assert.rejects(
      () => db.query(`update daily_activities set is_sample = false where id = $1`, [sampleActId]),
      /Sample flag and expiry cannot be modified/i,
    );

    // Visibility: creator (mgr1Id) and admin (adminId) see active sample; another manager (mgrApproverId) sees 0
    await setAuthUid(db, mgr1Id);
    await db.exec('begin; set local role authenticated;');
    const creatorSee = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [sampleActId]);
    await db.exec('commit;');
    assert.equal(creatorSee.rows[0]?.cnt, 1);

    await setAuthUid(db, adminId);
    await db.exec('begin; set local role authenticated;');
    const adminSee = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [sampleActId]);
    await db.exec('commit;');
    assert.equal(adminSee.rows[0]?.cnt, 1);

    await setAuthUid(db, mgrApproverId);
    await db.exec('begin; set local role authenticated;');
    const otherMgrSee = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [sampleActId]);
    await db.exec('commit;');
    assert.equal(otherMgrSee.rows[0]?.cnt, 0);

    // Sample job orders get SAMPLE-JO-YYYYMM-001 without consuming real JO-YYYYMM-001 sequence
    await setAuthUid(db, mgr1Id);
    const sampleJoRes = await db.query<{ id: string; jo_number: string }>(
      `insert into job_orders (organization_id, jo_number, title, created_by, is_sample)
       values ($1, 'AUTO', 'Sample JO', $2, true) returning id, jo_number`,
      [orgId, mgr1Id],
    );
    assert.match(sampleJoRes.rows[0].jo_number, /^SAMPLE-JO-\d{6}-001$/);

    const realJoRes = await db.query<{ id: string; jo_number: string }>(
      `insert into job_orders (organization_id, jo_number, title, created_by, is_sample)
       values ($1, 'AUTO', 'Real JO', $2, false) returning id, jo_number`,
      [orgId, mgr1Id],
    );
    assert.match(realJoRes.rows[0].jo_number, /^JO-\d{6}-001$/);

    // Sample handover & sample accomplishment report (verify 0 notifications fired on sample report)
    const sampleHoRes = await db.query<{ id: string }>(
      `insert into shift_handovers (organization_id, summary, created_by, is_sample)
       values ($1, 'Sample handover', $2, true) returning id`,
      [orgId, mgr1Id],
    );
    const notifsBefore = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from notifications where user_id = $1 and kind = 'report_submitted'`,
      [mgrApproverId],
    );
    const sampleRepRes = await db.query<{ id: string }>(
      `insert into accomplishment_reports (organization_id, report_date, submitted_by, assigned_head_id, status, is_sample)
       values ($1, '2026-11-24', $2, $3, 'submitted', true) returning id`,
      [orgId, mgr1Id, mgrApproverId],
    );
    const notifsAfter = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from notifications where user_id = $1 and kind = 'report_submitted'`,
      [mgrApproverId],
    );
    assert.equal(notifsAfter.rows[0]?.cnt, notifsBefore.rows[0]?.cnt);

    // Also insert a sample daily_activity WITH photos; purge_expired_sample_records() must spare it until storage photos are cleared
    const samplePhotoPath = `${orgId}/${mgr1Id}/sample-photo.jpg`;
    const samplePhotoActRes = await db.query<{ id: string }>(
      `insert into daily_activities (organization_id, logged_by, activity_type, photo_storage_paths, photo_urls, is_sample)
       values ($1, $2, 'pump_monitoring', array[$3]::text[], array[$4]::text[], true)
       returning id`,
      [orgId, mgr1Id, samplePhotoPath, `https://example.supabase.co/storage/v1/object/public/activity-media/${samplePhotoPath}`],
    );
    const samplePhotoActId = samplePhotoActRes.rows[0].id;

    // Backdate sample_expires_at via session trigger bypass isn't allowed; drop trigger check not needed — delete via alter trigger disable/enable?
    // Or test expired visibility + purge cleanly by temporarily disabling trg_*_sample_lifecycle for test setup!
    await db.exec(`
      alter table daily_activities disable trigger trg_daily_activities_sample_lifecycle;
      alter table job_orders disable trigger trg_job_orders_sample_lifecycle;
      alter table shift_handovers disable trigger trg_shift_handovers_sample_lifecycle;
      alter table accomplishment_reports disable trigger trg_accomplishment_reports_sample_lifecycle;
      update daily_activities set sample_expires_at = now() - interval '1 minute' where id in ('${sampleActId}', '${samplePhotoActId}');
      update job_orders set sample_expires_at = now() - interval '1 minute' where id = '${sampleJoRes.rows[0].id}';
      update shift_handovers set sample_expires_at = now() - interval '1 minute' where id = '${sampleHoRes.rows[0].id}';
      update accomplishment_reports set sample_expires_at = now() - interval '1 minute' where id = '${sampleRepRes.rows[0].id}';
      alter table daily_activities enable trigger trg_daily_activities_sample_lifecycle;
      alter table job_orders enable trigger trg_job_orders_sample_lifecycle;
      alter table shift_handovers enable trigger trg_shift_handovers_sample_lifecycle;
      alter table accomplishment_reports enable trigger trg_accomplishment_reports_sample_lifecycle;
    `);

    // Expired sample disappears from reads for BOTH creator and admin
    await setAuthUid(db, mgr1Id);
    await db.exec('begin; set local role authenticated;');
    const expiredCreatorSee = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [sampleActId]);
    await db.exec('commit;');
    assert.equal(expiredCreatorSee.rows[0]?.cnt, 0);

    await setAuthUid(db, adminId);
    await db.exec('begin; set local role authenticated;');
    const expiredAdminSee = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [sampleActId]);
    await db.exec('commit;');
    assert.equal(expiredAdminSee.rows[0]?.cnt, 0);

    // purge_expired_sample_records() is service_role-only, deletes photo-less expired samples, spares photo-bearing expired samples, and never touches real JO
    const purgePriv = await db.query<{ auth: boolean }>(
      `select has_function_privilege('authenticated', 'purge_expired_sample_records()', 'EXECUTE') as auth`,
    );
    assert.equal(purgePriv.rows[0]?.auth, false);

    await setAuthUid(db, null);
    await db.exec('begin; set local role service_role;');
    const purged = await db.query<{ activities_deleted: number; job_orders_deleted: number; handovers_deleted: number; reports_deleted: number }>(
      `select * from purge_expired_sample_records()`,
    );
    await db.exec('commit;');
    assert.deepEqual(purged.rows[0], {
      activities_deleted: 1,
      job_orders_deleted: 1,
      handovers_deleted: 1,
      reports_deleted: 1,
    });

    // Photo-bearing expired sample remains so /api/activities/purge-photos can remove Storage objects cleanly first
    const photoSampleStillHere = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from daily_activities where id = $1`,
      [samplePhotoActId],
    );
    assert.equal(photoSampleStillHere.rows[0]?.cnt, 1);

    // Once /api/activities/purge-photos removes Storage objects and clears photo columns, SQL purge deletes the row
    await db.query(
      `update daily_activities set photo_urls = '{}', photo_storage_paths = '{}', photos_purged_at = now() where id = $1`,
      [samplePhotoActId],
    );
    await db.exec('begin; set local role service_role;');
    const purgedAfterPhotoClear = await db.query<{ activities_deleted: number }>(
      `select activities_deleted from purge_expired_sample_records()`,
    );
    await db.exec('commit;');
    assert.equal(purgedAfterPhotoClear.rows[0]?.activities_deleted, 1);
    const photoSampleGone = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from daily_activities where id = $1`,
      [samplePhotoActId],
    );
    assert.equal(photoSampleGone.rows[0]?.cnt, 0);

    const realJoStillHere = await db.query<{ cnt: number }>(`select count(*)::int as cnt from job_orders where id = $1`, [realJoRes.rows[0].id]);
    assert.equal(realJoStillHere.rows[0]?.cnt, 1);

    // Re-running 034 migration is idempotent
    await db.exec(sql34);

    // 18. 035 Department heads: sample-only edits, review exceptions, sample photo queue, storage policy, health
    // Re-apply 035 because the 034 re-run above restored its older purge_expired_sample_records(); also proves idempotency.
    const sql35 = fs.readFileSync(path.join(MIGRATIONS_DIR, '035_dept_head_sample_only_edits.sql'), 'utf8');
    await db.exec(sql35);

    const runAs = async <T,>(uid: string | null, fn: () => Promise<T>, commit = false): Promise<T> => {
      await setAuthUid(db, uid);
      await db.exec('begin; set local role authenticated;');
      try {
        const out = await fn();
        await db.exec(commit ? 'commit;' : 'rollback;');
        return out;
      } catch (err) {
        await db.exec('rollback;');
        throw err;
      }
    };
    const NOT_ALLOWED = /Department heads|read-only|row-level security/i;

    // Admin creates one REAL row in each of the four tables.
    const realIds = await runAs(adminId, async () => {
      const act = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, activity_type) values ($1, 'pump_monitoring') returning id`,
        [orgId],
      );
      const jo = await db.query<{ id: string }>(
        `insert into job_orders (organization_id, jo_number, title, created_by) values ($1, 'AUTO', 'Real JO 035', $2) returning id`,
        [orgId, adminId],
      );
      const ho = await db.query<{ id: string }>(
        `insert into shift_handovers (organization_id, summary, created_by) values ($1, 'Real handover 035', $2) returning id`,
        [orgId, adminId],
      );
      const rep = await db.query<{ id: string }>(
        `insert into accomplishment_reports (organization_id, report_date, submitted_by, assigned_head_id, status)
         values ($1, '2026-11-25', $2, $3, 'submitted') returning id`,
        [orgId, adminId, mgr1Id],
      );
      return { act: act.rows[0].id, jo: jo.rows[0].id, ho: ho.rows[0].id, rep: rep.rows[0].id };
    }, true);

    // A department head cannot edit or delete any real row.
    const realEdits: Array<[string, string, unknown[]]> = [
      [`update daily_activities set notes = 'tamper' where id = $1`, 'activity edit', [realIds.act]],
      [`update job_orders set title = 'tamper' where id = $1`, 'job order edit', [realIds.jo]],
      [`update job_orders set status = 'completed' where id = $1`, 'job order status', [realIds.jo]],
      [`update shift_handovers set summary = 'tamper' where id = $1`, 'handover edit', [realIds.ho]],
      [`update accomplishment_reports set summary_notes = 'tamper' where id = $1`, 'report edit', [realIds.rep]],
      [`update accomplishment_reports set entries = '[{"x":1}]'::jsonb where id = $1`, 'report entries edit', [realIds.rep]],
      [`delete from daily_activities where id = $1`, 'activity delete', [realIds.act]],
      [`delete from job_orders where id = $1`, 'job order delete', [realIds.jo]],
      [`delete from shift_handovers where id = $1`, 'handover delete', [realIds.ho]],
      [`delete from accomplishment_reports where id = $1`, 'report delete', [realIds.rep]],
    ];
    for (const [sql, label, params] of realEdits) {
      if (sql.startsWith('delete')) {
        // RLS may hide the row (0 rows affected) or the 035 guard may raise; either way the row must survive.
        let affected = 0;
        try {
          affected = await runAs(mgr1Id, async () => (await db.query(sql, params)).affectedRows ?? 0);
        } catch (err) {
          assert.match(String(err instanceof Error ? err.message : err), NOT_ALLOWED, `manager must not do: ${label}`);
        }
        assert.equal(affected, 0, `manager must not do: ${label}`);
      } else {
        await assert.rejects(() => runAs(mgr1Id, () => db.query(sql, params)), NOT_ALLOWED, `manager must not do: ${label}`);
      }
    }
    for (const [table, id] of [
      ['daily_activities', realIds.act],
      ['job_orders', realIds.jo],
      ['shift_handovers', realIds.ho],
      ['accomplishment_reports', realIds.rep],
    ] as const) {
      await setAuthUid(db, null);
      const still = await db.query<{ cnt: number }>(`select count(*)::int as cnt from ${table} where id = $1`, [id]);
      assert.equal(still.rows[0].cnt, 1, `${table} real row must survive the department head delete attempts`);
    }

    // ...and cannot bypass the guard by flipping the sample flag or changing a verification payload alongside.
    await assert.rejects(
      () => runAs(mgr1Id, () => db.query(`update daily_activities set status = 'verified', notes = 'tamper' where id = $1`, [realIds.act])),
      NOT_ALLOWED,
    );
    await assert.rejects(
      () => runAs(mgr1Id, () => db.query(`update daily_activities set status = 'draft' where id = $1`, [realIds.act])),
      /only verify or flag/i,
    );
    await assert.rejects(
      () => runAs(mgr1Id, () => db.query(`update job_orders set is_sample = true where id = $1`, [realIds.jo])),
      /Sample flag|Department heads/i,
    );

    // Review actions stay available to department heads.
    await runAs(mgr1Id, async () => {
      const v = await db.query(
        `update daily_activities set status = 'verified', verified_by = $2, verified_at = now(), review_note = 'ok' where id = $1`,
        [realIds.act, mgr1Id],
      );
      assert.equal(v.affectedRows, 1);
      const c = await db.query(
        `update accomplishment_reports set status = 'checked', checked_by = $2, checked_at = now(), head_remarks = 'good' where id = $1`,
        [realIds.rep, mgr1Id],
      );
      assert.equal(c.affectedRows, 1);
    });

    // Admins (and service_role / SQL) are unaffected on real rows.
    await runAs(adminId, async () => {
      const u = await db.query(`update job_orders set title = 'Admin fixed' where id = $1`, [realIds.jo]);
      assert.equal(u.affectedRows, 1);
    });
    await setAuthUid(db, null);
    await db.query(`update shift_handovers set summary = 'service edit' where id = $1`, [realIds.ho]);

    // Department head sandbox: full create / edit / delete on SAMPLE rows in all four tables.
    await runAs(mgr1Id, async () => {
      const act = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, is_sample) values ($1, $2, 'pump_monitoring', true) returning id`,
        [orgId, mgr1Id],
      );
      const jo = await db.query<{ id: string }>(
        `insert into job_orders (organization_id, jo_number, title, created_by, is_sample) values ($1, 'AUTO', 'S', $2, true) returning id`,
        [orgId, mgr1Id],
      );
      const ho = await db.query<{ id: string }>(
        `insert into shift_handovers (organization_id, summary, created_by, is_sample) values ($1, 'S', $2, true) returning id`,
        [orgId, mgr1Id],
      );
      const rep = await db.query<{ id: string }>(
        `insert into accomplishment_reports (organization_id, report_date, submitted_by, status, is_sample) values ($1, '2026-11-25', $2, 'draft', true) returning id`,
        [orgId, mgr1Id],
      );
      assert.equal((await db.query(`update daily_activities set notes = 'edited' where id = $1`, [act.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`update job_orders set title = 'edited' where id = $1`, [jo.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`update shift_handovers set summary = 'edited' where id = $1`, [ho.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`update accomplishment_reports set summary_notes = 'edited' where id = $1`, [rep.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`delete from daily_activities where id = $1`, [act.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`delete from job_orders where id = $1`, [jo.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`delete from shift_handovers where id = $1`, [ho.rows[0].id])).affectedRows, 1);
      assert.equal((await db.query(`delete from accomplishment_reports where id = $1`, [rep.rows[0].id])).affectedRows, 1);
    });

    // 24h cleanup is self-sufficient: expired samples with photos are deleted in SQL and their files are queued.
    const photoA = `${orgId}/2026-11-25/sample-aaa.webp`;
    const photoB = `${orgId}/2026-11-25/sample-bbb.webp`;
    const foreignPhoto = '99999999-9999-4999-8999-999999999999/2026-11-25/sample-ccc.webp';
    const photoSampleId = await runAs(mgr1Id, async () => {
      const r = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths, photo_urls)
         values ($1, $2, 'pump_monitoring', true, $3::text[], $4::text[]) returning id`,
        [orgId, mgr1Id, [photoA, foreignPhoto], [`/api/activities/photo?path=${encodeURIComponent(photoB)}`]],
      );
      return r.rows[0].id;
    }, true);
    await setAuthUid(db, null);
    await db.exec(`
      alter table daily_activities disable trigger trg_daily_activities_sample_lifecycle;
      update daily_activities set sample_expires_at = now() - interval '1 minute' where id = '${photoSampleId}';
      alter table daily_activities enable trigger trg_daily_activities_sample_lifecycle;
    `);

    const healthBefore = await runAs(adminId, async () => {
      const h = await db.query<{ h: Record<string, unknown> }>(`select sample_cleanup_health() as h`);
      return h.rows[0].h;
    });
    assert.equal(healthBefore.overdue_samples, 0, 'a sample expired a minute ago is not yet "overdue"');
    assert.equal(healthBefore.pg_cron_scheduled, false);
    await assert.rejects(
      () => runAs(mgr1Id, () => db.query(`select sample_cleanup_health()`)),
      /Only admins/i,
    );

    await setAuthUid(db, null);
    await db.exec('begin; set local role service_role;');
    const purge35 = await db.query<{ activities_deleted: number }>(`select * from purge_expired_sample_records()`);
    await db.exec('commit;');
    assert.equal(purge35.rows[0].activities_deleted, 1, 'expired sample with photos is deleted in SQL, not left behind');
    const rowGone = await db.query<{ cnt: number }>(`select count(*)::int as cnt from daily_activities where id = $1`, [photoSampleId]);
    assert.equal(rowGone.rows[0].cnt, 0);

    const queued = await db.query<{ storage_path: string }>(`select storage_path from sample_photo_cleanup order by storage_path`);
    assert.deepEqual(queued.rows.map((r) => r.storage_path), [photoA, photoB], 'own-org photo paths queued; foreign-org path ignored');

    await db.exec('begin; set local role service_role;');
    await db.query(`select * from purge_expired_sample_records()`);
    await db.exec('commit;');
    const queuedAgain = await db.query<{ cnt: number }>(`select count(*)::int as cnt from sample_photo_cleanup`);
    assert.equal(queuedAgain.rows[0].cnt, 2, 're-running the purge never duplicates queue rows');

    await assert.rejects(
      () => runAs(adminId, () => db.query(`select * from sample_photo_cleanup`)),
      /permission denied/i,
    );

    // Storage: department heads may handle sample-* objects only; operators/admins keep full access.
    await db.exec(`grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated; grant select on public.user_profiles to authenticated;`);
    const realObj = `${orgId}/2026-11-25/123-real.webp`;
    const sampleObj = `${orgId}/2026-11-25/sample-123.webp`;
    await assert.rejects(
      () => runAs(mgr1Id, () => db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [realObj])),
      /row-level security/i,
    );
    await runAs(mgr1Id, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [sampleObj]);
    }, true);
    await runAs(adminId, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [realObj]);
    }, true);
    await runAs(mgr1Id, async () => {
      const delReal = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [realObj]);
      assert.equal(delReal.affectedRows, 0, 'department head cannot delete a real activity photo');
      const delSample = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [sampleObj]);
      assert.equal(delSample.affectedRows, 1, 'department head can delete a sample photo');
    });

    // 035 idempotent
    await db.exec(sql35);

    // 19. 036 Realtime publication for edit_grants (registered, idempotent, and safe if publication is missing)
    const rtEditGrants = await db.query<{ schemaname: string; tablename: string }>(
      `select schemaname, tablename
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'edit_grants'`,
    );
    assert.equal(rtEditGrants.rows.length, 1);
    assert.deepEqual(rtEditGrants.rows[0], { schemaname: 'public', tablename: 'edit_grants' });

    // Re-running 036 migration is idempotent
    const sql36 = fs.readFileSync(path.join(MIGRATIONS_DIR, '036_realtime_edit_grants.sql'), 'utf8');
    await db.exec(sql36);
    const rtEditGrantsAfter = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'edit_grants'`,
    );
    assert.equal(rtEditGrantsAfter.rows[0]?.cnt, 1);

    // Guard handles environments without supabase_realtime publication cleanly
    await db.exec('begin; drop publication supabase_realtime;');
    await db.exec(sql36);
    await db.exec('rollback;');

    // 20. 037 Harden RLS, trigger integrity guards, and sample photo isolation
    // Re-apply 037 because sections 17-18 re-ran 034 and 035; also re-run at end for idempotency.
    const sql37 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_harden_rls_and_sample_photo_isolation.sql'), 'utf8');
    await db.exec(sql37);

    // Ensure two distinct operators, an unlinked operator, and a scheduler exist in orgId
    const unlinkedOpUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const schedUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await setAuthUid(db, null);
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'unlinkedop@bpwaterworks.com', $2::jsonb)`,
      [unlinkedOpUserId, JSON.stringify({ full_name: 'Unlinked Op' })],
    );
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'scheduler@bpwaterworks.com', $2::jsonb)`,
      [schedUserId, JSON.stringify({ full_name: 'Org Scheduler' })],
    );
    await db.query(`update user_profiles set role = 'operator', is_active = true, operator_id = null where id = $1`, [
      unlinkedOpUserId,
    ]);
    await db.query(`update user_profiles set role = 'scheduler', is_active = true where id = $1`, [schedUserId]);

    // 20a. Sample photo path & URL isolation in enforce_sample_log_lifecycle()
    const validSamplePath = `${orgId}/2026-11-25/sample-valid.webp`;
    const validSampleUrl = `/api/activities/photo?path=${encodeURIComponent(validSamplePath)}`;
    const badRealPath = `${orgId}/2026-11-25/real-photo.webp`;
    const badForeignSamplePath = `99999999-9999-4999-8999-999999999999/2026-11-25/sample-foreign.webp`;

    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths)
             values ($1, $2, 'pump_monitoring', true, $3::text[])`,
            [orgId, mgr1Id, [badRealPath]],
          ),
        ),
      /sample-\* paths/i,
    );
    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths)
             values ($1, $2, 'pump_monitoring', true, $3::text[])`,
            [orgId, mgr1Id, [badForeignSamplePath]],
          ),
        ),
      /sample-\* paths/i,
    );
    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_urls)
             values ($1, $2, 'pump_monitoring', true, $3::text[])`,
            [orgId, mgr1Id, [`/api/activities/photo?path=${orgId}%2F2026-11-25%2Freal-photo.webp`]],
          ),
        ),
      /sample-\* objects/i,
    );
    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_urls)
             values ($1, $2, 'pump_monitoring', true, $3::text[])`,
            [orgId, mgr1Id, [`/storage/v1/object/public/activity-media/${badRealPath}`]],
          ),
        ),
      /sample-\* objects/i,
    );

    const isolatedSampleId = await runAs(mgr1Id, async () => {
      const r = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths, photo_urls)
         values ($1, $2, 'pump_monitoring', true, $3::text[], $4::text[]) returning id`,
        [orgId, mgr1Id, [validSamplePath], [validSampleUrl, 'data:image/png;base64,AAA']],
      );
      return r.rows[0].id;
    }, true);

    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(`update daily_activities set photo_storage_paths = $2::text[] where id = $1`, [
            isolatedSampleId,
            [badRealPath],
          ]),
        ),
      /sample-\* paths/i,
    );
    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(`update daily_activities set photo_urls = $2::text[] where id = $1`, [
            isolatedSampleId,
            [`/api/activities/photo?path=${encodeURIComponent(badForeignSamplePath)}`],
          ]),
        ),
      /sample-\* objects/i,
    );

    // 20b. purge_expired_sample_records() skips paths referenced by live real activities & non-sample paths
    await setAuthUid(db, null);
    await db.query(`delete from sample_photo_cleanup`);
    const sharedSamplePath = `${orgId}/2026-11-25/sample-shared.webp`;
    const onlySamplePath = `${orgId}/2026-11-25/sample-only-37.webp`;
    await db.query(
      `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths, photo_urls)
       values ($1, $2, 'pump_monitoring', false, $3::text[], $4::text[])`,
      [orgId, assignedUserId, [sharedSamplePath], [`/api/activities/photo?path=${encodeURIComponent(sharedSamplePath)}`]],
    );
    await db.exec(`
      alter table daily_activities disable trigger trg_daily_activities_sample_lifecycle;
      update daily_activities
      set sample_expires_at = now() - interval '1 minute',
          photo_storage_paths = array['${sharedSamplePath}', '${onlySamplePath}', '${badRealPath}']::text[],
          photo_urls = array['/api/activities/photo?path=' || '${sharedSamplePath}']::text[]
      where id = '${isolatedSampleId}';
      alter table daily_activities enable trigger trg_daily_activities_sample_lifecycle;
    `);
    await db.exec('begin; set local role service_role;');
    const purge37 = await db.query<{ activities_deleted: number }>(`select * from purge_expired_sample_records()`);
    await db.exec('commit;');
    assert.equal(purge37.rows[0]?.activities_deleted, 1);

    const queued37 = await db.query<{ storage_path: string }>(`select storage_path from sample_photo_cleanup order by storage_path`);
    assert.deepEqual(
      queued37.rows.map((r) => r.storage_path),
      [onlySamplePath],
      'purge must queue own-org sample-* path not referenced by any live activity, and skip shared/real paths',
    );
    const purgeAuth37 = await db.query<{ auth: boolean }>(
      `select has_function_privilege('authenticated', 'purge_expired_sample_records()', 'EXECUTE') as auth`,
    );
    assert.equal(purgeAuth37.rows[0]?.auth, false);

    // 20c. Tighten storage.objects "activity-media purge delete" policy
    const op1DraftObj = `${orgId}/2026-11-25/op1-draft.webp`;
    const op1VerifiedObj = `${orgId}/2026-11-25/op1-verified.webp`;
    const realSampleNamedObj = `${orgId}/2026-11-25/sample-attached-to-real.webp`;
    const otherMgrSampleObj = `${orgId}/2026-11-25/sample-other-mgr.webp`;
    const ownMgrSampleObj = `${orgId}/2026-11-25/sample-own-mgr.webp`;
    const schedTargetObj = `${orgId}/2026-11-25/sched-purge.webp`;

    await runAs(assignedUserId, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [op1DraftObj]);
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [op1VerifiedObj]);
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [schedTargetObj]);
    }, true);
    await runAs(mgr1Id, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [ownMgrSampleObj]);
    }, true);
    await runAs(mgrApproverId, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [otherMgrSampleObj]);
      await db.query(
        `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths)
         values ($1, $2, 'pump_monitoring', true, $3::text[])`,
        [orgId, mgrApproverId, [otherMgrSampleObj]],
      );
    }, true);
    await runAs(adminId, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('activity-media', $1)`, [realSampleNamedObj]);
      await db.query(
        `insert into daily_activities (organization_id, logged_by, activity_type, is_sample, photo_storage_paths)
         values ($1, $2, 'pump_monitoring', false, $3::text[])`,
        [orgId, adminId, [realSampleNamedObj]],
      );
      const actForVerify = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, status, is_sample, photo_storage_paths)
         values ($1, $2, 'pump_monitoring', 'verified', false, $3::text[]) returning id`,
        [orgId, assignedUserId, [op1VerifiedObj]],
      );
      assert.ok(actForVerify.rows[0].id);
    }, true);

    // Other operator cannot delete op1DraftObj (owner mismatch)
    await runAs(subUserId, async () => {
      const delOtherOp = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [op1DraftObj]);
      assert.equal(delOtherOp.affectedRows, 0, 'operator cannot delete another operator storage object');
    });
    // Owner operator cannot delete op1VerifiedObj (referenced by verified activity), CAN delete own unverified op1DraftObj
    await runAs(assignedUserId, async () => {
      const delVer = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [op1VerifiedObj]);
      assert.equal(delVer.affectedRows, 0, 'operator cannot delete photo referenced by verified activity');
      const delDraft = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [op1DraftObj]);
      assert.equal(delDraft.affectedRows, 1, 'operator can delete own unverified photo');
    }, true);
    // Manager cannot delete sample-* object referenced by real activity or another manager sample, CAN delete own sample object
    await runAs(mgr1Id, async () => {
      const delAttachedReal = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [realSampleNamedObj]);
      assert.equal(delAttachedReal.affectedRows, 0, 'manager cannot delete sample-* object attached to real activity');
      const delOtherMgr = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [otherMgrSampleObj]);
      assert.equal(delOtherMgr.affectedRows, 0, 'manager cannot delete sample-* object owned by another user activity');
      const delOwnSample = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [ownMgrSampleObj]);
      assert.equal(delOwnSample.affectedRows, 1, 'manager can delete own sample-* object');
    }, true);
    // Scheduler can purge org objects
    await runAs(schedUserId, async () => {
      const delSched = await db.query(`delete from storage.objects where bucket_id = 'activity-media' and name = $1`, [schedTargetObj]);
      assert.equal(delSched.affectedRows, 1, 'scheduler can delete org storage object');
    }, true);

    // 20d. Harden daily_activities insert policy & touch_daily_activities_updated_at()
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type)
             values ($1, $2, 'pump_monitoring')`,
            [orgId, subUserId],
          ),
        ),
      /row-level security|own user ID/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, status)
             values ($1, $2, 'pump_monitoring', 'verified')`,
            [orgId, assignedUserId],
          ),
        ),
      /draft or submitted/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, review_note)
             values ($1, $2, 'pump_monitoring', 'self-approved')`,
            [orgId, assignedUserId],
          ),
        ),
      /verification fields on insert/i,
    );

    const opActId = await runAs(assignedUserId, async () => {
      const r = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, status)
         values ($1, $2, 'pump_monitoring', 'submitted') returning id`,
        [orgId, assignedUserId],
      );
      return r.rows[0].id;
    }, true);

    await assert.rejects(
      () => runAs(assignedUserId, () => db.query(`update daily_activities set logged_by = $2 where id = $1`, [opActId, subUserId])),
      /creator cannot be reassigned|row-level security/i,
    );
    await assert.rejects(
      () => runAs(assignedUserId, () => db.query(`update daily_activities set status = 'verified' where id = $1`, [opActId])),
      /verify or flag/i,
    );

    await runAs(mgr1Id, async () => {
      await db.query(`update daily_activities set status = 'verified', verified_by = $2, verified_at = now() where id = $1`, [
        opActId,
        mgr1Id,
      ]);
    }, true);

    await assert.rejects(
      () => runAs(assignedUserId, () => db.query(`update daily_activities set notes = 'post-verify tamper' where id = $1`, [opActId])),
      /Verified activity logs cannot be modified by operators/i,
    );

    // 20e. Harden accomplishment_reports integrity trigger & update RLS
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into accomplishment_reports (organization_id, report_date, submitted_by, status)
             values ($1, '2026-11-25', $2, 'checked')`,
            [orgId, assignedUserId],
          ),
        ),
      /draft or submitted/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into accomplishment_reports (organization_id, report_date, submitted_by, head_remarks)
             values ($1, '2026-11-25', $2, 'pre-approved')`,
            [orgId, assignedUserId],
          ),
        ),
      /review fields on insert/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into accomplishment_reports (organization_id, report_date, submitted_by, assigned_head_id, status)
             values ($1, '2026-11-25', $2, $2, 'submitted')`,
            [orgId, assignedUserId],
          ),
        ),
      /assign themselves as reviewing head/i,
    );

    const opRepId = await runAs(assignedUserId, async () => {
      const r = await db.query<{ id: string }>(
        `insert into accomplishment_reports (organization_id, report_date, submitted_by, assigned_head_id, status)
         values ($1, '2026-11-25', $2, $3, 'submitted') returning id`,
        [orgId, assignedUserId, subUserId],
      );
      return r.rows[0].id;
    }, true);

    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(`update accomplishment_reports set status = 'checked' where id = $1`, [opRepId]),
        ),
      /check or return reports/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(`update accomplishment_reports set assigned_head_id = $2 where id = $1`, [opRepId, assignedUserId]),
        ),
      /assign themselves as reviewing head/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(`update accomplishment_reports set head_remarks = 'tamper', checked_by_name = 'Fake' where id = $1`, [opRepId]),
        ),
      /modify review fields/i,
    );

    // Self-assigned report inserted as service role cannot be checked by submitter even if assigned_head_id = submitted_by
    await setAuthUid(db, null);
    const selfAssignedRepRes = await db.query<{ id: string }>(
      `insert into accomplishment_reports (organization_id, report_date, submitted_by, assigned_head_id, status)
       values ($1, '2026-11-25', $2, $2, 'submitted') returning id`,
      [orgId, assignedUserId],
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(`update accomplishment_reports set status = 'checked', checked_by = $2 where id = $1`, [
            selfAssignedRepRes.rows[0].id,
            assignedUserId,
          ]),
        ),
      /check or return reports/i,
    );

    // Assigned head (different user) CAN review, but cannot change submitted_by, and checked reports become immutable
    await assert.rejects(
      () =>
        runAs(subUserId, () =>
          db.query(`update accomplishment_reports set submitted_by = $2 where id = $1`, [opRepId, subUserId]),
        ),
      /submitter cannot be changed|row-level security/i,
    );
    await runAs(subUserId, async () => {
      const chk = await db.query(
        `update accomplishment_reports set status = 'checked', checked_by = $2, checked_at = now(), head_remarks = 'Verified by head' where id = $1`,
        [opRepId, subUserId],
      );
      assert.equal(chk.affectedRows, 1);
    }, true);
    await assert.rejects(
      () =>
        runAs(subUserId, () =>
          db.query(`update accomplishment_reports set head_remarks = 're-edit' where id = $1`, [opRepId]),
        ),
      /Checked accomplishment reports cannot be modified/i,
    );

    // 20f. Fix job_orders update policy (no current_operator_id() is null bypass)
    await setAuthUid(db, null);
    const joUnassignedRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, assigned_operator_ids, created_by)
       values ($1, 'AUTO', 'Unassigned JO 037', '{}'::uuid[], $2) returning id`,
      [orgId, adminId],
    );
    const joOtherOpRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, assigned_operator_ids, created_by)
       values ($1, 'AUTO', 'Other Op JO 037', array[$2]::uuid[], $3) returning id`,
      [orgId, subOpId, adminId],
    );
    const joAssignedOpRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, assigned_operator_ids, created_by)
       values ($1, 'AUTO', 'Assigned Op JO 037', array[$2]::uuid[], $3) returning id`,
      [orgId, opId, adminId],
    );

    await runAs(unlinkedOpUserId, async () => {
      const updUnlinked = await db.query(`update job_orders set status = 'in_progress' where id = $1`, [joUnassignedRes.rows[0].id]);
      assert.equal(updUnlinked.affectedRows, 0, 'operator without linked operator_id cannot update job orders');
    });
    await runAs(assignedUserId, async () => {
      const updOther = await db.query(`update job_orders set status = 'in_progress' where id = $1`, [joOtherOpRes.rows[0].id]);
      assert.equal(updOther.affectedRows, 0, 'operator cannot update job order assigned only to another operator');
      const updMine = await db.query(`update job_orders set status = 'in_progress' where id = $1`, [joAssignedOpRes.rows[0].id]);
      assert.equal(updMine.affectedRows, 1, 'assigned operator can update own job order');
      const updOpen = await db.query(`update job_orders set status = 'in_progress' where id = $1`, [joUnassignedRes.rows[0].id]);
      assert.equal(updOpen.affectedRows, 1, 'linked operator can claim unassigned job order');
    });

    // Re-running 037 migration is idempotent
    await setAuthUid(db, null);
    await db.exec(sql37);

    // 21. 038 GIN indexes on daily_activities photo arrays & RA 10173 telemetry PII retention purge
    const sql38 = fs.readFileSync(path.join(MIGRATIONS_DIR, '038_photo_paths_gin_and_telemetry_retention.sql'), 'utf8');
    await db.exec(sql38);

    // 21a. Verify both GIN indexes exist on daily_activities
    const ginIdxRes = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'daily_activities'
         and indexname in ('daily_activities_photo_storage_paths_gin_idx', 'daily_activities_photo_urls_gin_idx')
       order by indexname`,
    );
    assert.deepEqual(
      ginIdxRes.rows.map((r) => r.indexname),
      ['daily_activities_photo_storage_paths_gin_idx', 'daily_activities_photo_urls_gin_idx'],
    );
    for (const row of ginIdxRes.rows) {
      assert.match(row.indexdef, /using gin/i);
    }

    // 21b. Verify purge_expired_telemetry_pii(int) privileges (service_role only)
    const piiPrivs = await db.query<{ pub: boolean; anon: boolean; auth: boolean; svc: boolean }>(
      `select
         has_function_privilege('public', 'purge_expired_telemetry_pii(int)', 'EXECUTE') as pub,
         has_function_privilege('anon', 'purge_expired_telemetry_pii(int)', 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'purge_expired_telemetry_pii(int)', 'EXECUTE') as auth,
         has_function_privilege('service_role', 'purge_expired_telemetry_pii(int)', 'EXECUTE') as svc`,
    );
    assert.deepEqual(piiPrivs.rows[0], { pub: false, anon: false, auth: false, svc: true });

    await setAuthUid(db, adminId);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(() => db.query(`select * from purge_expired_telemetry_pii(365)`), /permission denied/i);
    await db.exec('rollback;');

    // 21c. Retention period < 30 days (or null) raises SQLSTATE 22023
    await setAuthUid(db, null);
    await db.exec('begin; set local role service_role;');
    await assert.rejects(
      () => db.query(`select * from purge_expired_telemetry_pii(29)`),
      (err: unknown) => {
        assert.match(err instanceof Error ? err.message : String(err), /Retention period must be at least 30 days/i);
        assert.equal((err as { code?: string }).code, '22023');
        return true;
      },
    );
    await db.exec('rollback;');

    await db.exec('begin; set local role service_role;');
    await assert.rejects(
      () => db.query(`select * from purge_expired_telemetry_pii(null)`),
      (err: unknown) => {
        assert.match(err instanceof Error ? err.message : String(err), /Retention period must be at least 30 days/i);
        assert.equal((err as { code?: string }).code, '22023');
        return true;
      },
    );
    await db.exec('rollback;');

    // 21d. Seed expired vs recent activities and closed vs open/recent job orders
    const expActRes = await db.query<{ id: string }>(
      `insert into daily_activities (organization_id, logged_by, activity_type, gps_lat, gps_lng, signature_data, notes, details, is_sample, created_at)
       values ($1, $2, 'pump_monitoring', 10.7202, 122.5621, 'data:image/png;base64,SIGOLD', 'Keep operational note', $3::jsonb, false, now() - interval '400 days')
       returning id`,
      [orgId, assignedUserId, JSON.stringify({ gpsSource: 'device', gpsAccuracyM: 8, pumpPressure: 42 })],
    );
    const expActId = expActRes.rows[0].id;

    const recentActRes = await db.query<{ id: string }>(
      `insert into daily_activities (organization_id, logged_by, activity_type, gps_lat, gps_lng, signature_data, notes, details, is_sample, created_at)
       values ($1, $2, 'pump_monitoring', 10.7300, 122.5700, 'data:image/png;base64,SIGNEW', 'Recent note', $3::jsonb, false, now() - interval '10 days')
       returning id`,
      [orgId, assignedUserId, JSON.stringify({ gpsSource: 'map_pin', gpsAccuracyM: 12 })],
    );
    const recentActId = recentActRes.rows[0].id;

    const expSampleActRes = await db.query<{ id: string }>(
      `insert into daily_activities (organization_id, logged_by, activity_type, gps_lat, gps_lng, signature_data, details, is_sample, created_at)
       values ($1, $2, 'pump_monitoring', 10.7400, 122.5800, 'sample-sig', $3::jsonb, true, now() - interval '400 days')
       returning id`,
      [orgId, mgr1Id, JSON.stringify({ gpsSource: 'device', gpsAccuracyM: 5 })],
    );
    const expSampleActId = expSampleActRes.rows[0].id;

    const expCompletedJoRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, status, contact_number, completed_at, created_at, updated_at, created_by, is_sample)
       values ($1, 'AUTO', 'Expired Completed JO', 'completed', '09171234567', now() - interval '400 days', now() - interval '405 days', now() - interval '400 days', $2, false)
       returning id`,
      [orgId, adminId],
    );
    const expCompletedJoId = expCompletedJoRes.rows[0].id;

    const expCancelledJoRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, status, contact_number, completed_at, created_at, updated_at, created_by, is_sample)
       values ($1, 'AUTO', 'Expired Cancelled JO', 'cancelled', '09181234567', null, now() - interval '410 days', now() - interval '400 days', $2, false)
       returning id`,
      [orgId, adminId],
    );
    const expCancelledJoId = expCancelledJoRes.rows[0].id;

    const openOldJoRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, status, contact_number, created_at, updated_at, created_by, is_sample)
       values ($1, 'AUTO', 'Open Old JO', 'in_progress', '09191234567', now() - interval '400 days', now() - interval '400 days', $2, false)
       returning id`,
      [orgId, adminId],
    );
    const openOldJoId = openOldJoRes.rows[0].id;

    const recentCompletedJoRes = await db.query<{ id: string }>(
      `insert into job_orders (organization_id, jo_number, title, status, contact_number, completed_at, created_at, updated_at, created_by, is_sample)
       values ($1, 'AUTO', 'Recent Completed JO', 'completed', '09201234567', now() - interval '10 days', now() - interval '15 days', now() - interval '10 days', $2, false)
       returning id`,
      [orgId, adminId],
    );
    const recentCompletedJoId = recentCompletedJoRes.rows[0].id;

    // Run telemetry PII retention purge as service_role
    await db.exec('begin; set local role service_role;');
    const purgePiiRes = await db.query<{ activities_scrubbed: number; job_orders_scrubbed: number }>(
      `select * from purge_expired_telemetry_pii(365)`,
    );
    await db.exec('commit;');
    assert.deepEqual(purgePiiRes.rows[0], { activities_scrubbed: 1, job_orders_scrubbed: 2 });

    // Expired real activity: GPS/signature/gpsMeta scrubbed, operational note & other details preserved
    const expActAfter = await db.query<{
      gps_lat: string | null;
      gps_lng: string | null;
      signature_data: string | null;
      notes: string | null;
      details: Record<string, unknown>;
    }>(`select gps_lat, gps_lng, signature_data, notes, details from daily_activities where id = $1`, [expActId]);
    assert.equal(expActAfter.rows[0].gps_lat, null);
    assert.equal(expActAfter.rows[0].gps_lng, null);
    assert.equal(expActAfter.rows[0].signature_data, null);
    assert.equal(expActAfter.rows[0].notes, 'Keep operational note');
    assert.deepEqual(expActAfter.rows[0].details, { pumpPressure: 42 });

    // Recent real activity & sample activity remain untouched
    const recentActAfter = await db.query<{
      gps_lat: string | null;
      gps_lng: string | null;
      signature_data: string | null;
      details: Record<string, unknown>;
    }>(`select gps_lat, gps_lng, signature_data, details from daily_activities where id = $1`, [recentActId]);
    assert.ok(recentActAfter.rows[0].gps_lat !== null);
    assert.ok(recentActAfter.rows[0].gps_lng !== null);
    assert.equal(recentActAfter.rows[0].signature_data, 'data:image/png;base64,SIGNEW');
    assert.deepEqual(recentActAfter.rows[0].details, { gpsSource: 'map_pin', gpsAccuracyM: 12 });

    const sampleActAfter = await db.query<{ gps_lat: string | null; signature_data: string | null }>(
      `select gps_lat, signature_data from daily_activities where id = $1`,
      [expSampleActId],
    );
    assert.ok(sampleActAfter.rows[0].gps_lat !== null);
    assert.equal(sampleActAfter.rows[0].signature_data, 'sample-sig');

    // Expired completed & cancelled JOs scrubbed; open & recent completed JOs intact
    const joContacts = await db.query<{ id: string; contact_number: string | null }>(
      `select id, contact_number from job_orders where id = any($1::uuid[])`,
      [[expCompletedJoId, expCancelledJoId, openOldJoId, recentCompletedJoId]],
    );
    const contactMap = new Map(joContacts.rows.map((r) => [r.id, r.contact_number]));
    assert.equal(contactMap.get(expCompletedJoId), null);
    assert.equal(contactMap.get(expCancelledJoId), null);
    assert.equal(contactMap.get(openOldJoId), '09191234567');
    assert.equal(contactMap.get(recentCompletedJoId), '09201234567');

    // Second run is a no-op
    await db.exec('begin; set local role service_role;');
    const purgePiiSecond = await db.query<{ activities_scrubbed: number; job_orders_scrubbed: number }>(
      `select * from purge_expired_telemetry_pii(365)`,
    );
    await db.exec('commit;');
    assert.deepEqual(purgePiiSecond.rows[0], { activities_scrubbed: 0, job_orders_scrubbed: 0 });

    // Re-running 038 migration is idempotent
    await db.exec(sql38);

    // 22. 039 Per-site consumables inventory, RLS & auto-sync triggers from daily_activities
    const sql39 = fs.readFileSync(path.join(MIGRATIONS_DIR, '039_consumables_inventory.sql'), 'utf8');
    await db.exec(sql39);

    // 22a. Starter items seeded automatically for existing org
    const starterItemsRes = await db.query<{ id: string; code: string; unit: string }>(
      `select id, code, unit from consumable_items where organization_id = $1 and code is not null order by sort_order`,
      [orgId],
    );
    assert.deepEqual(
      starterItemsRes.rows.map((r) => ({ code: r.code, unit: r.unit })),
      [
        { code: 'CHLORINE_GRAN', unit: 'kg' },
        { code: 'CHLORINE_LIQ', unit: 'L' },
        { code: 'GASOLINE', unit: 'L' },
        { code: 'DIESEL', unit: 'L' },
      ],
    );
    const clGranId = starterItemsRes.rows[0].id;
    const gasId = starterItemsRes.rows[2].id;
    const dieselId = starterItemsRes.rows[3].id;

    // 22b. Manager can add custom consumable + record opening stock; Operator is read-only under RLS
    await runAs(mgr1Id, async () => {
      const oilRes = await db.query<{ id: string }>(
        `insert into consumable_items (organization_id, name, category, unit, low_stock_threshold)
         values ($1, 'Engine Oil 15W-40', 'lubricant', 'L', 10) returning id`,
        [orgId],
      );
      assert.ok(oilRes.rows[0].id);

      const openRes = await db.query<{ id: string }>(
        `insert into consumable_movements (organization_id, item_id, site_name, movement_type, quantity_delta, movement_date, created_by)
         values ($1, $2, 'Well 4 BAR', 'opening_stock', 50, '2026-11-20', $3) returning id`,
        [orgId, clGranId, mgr1Id],
      );
      assert.ok(openRes.rows[0].id);
    }, true);

    // Manager cannot spoof activity-synced movement rows
    await assert.rejects(
      () =>
        runAs(mgr1Id, () =>
          db.query(
            `insert into consumable_movements (organization_id, item_id, site_name, movement_type, quantity_delta)
             values ($1, $2, 'Well 4 BAR', 'activity_usage', -5)`,
            [orgId, clGranId],
          ),
        ),
      /row-level security/i,
    );

    // Operator can read inventory but cannot insert items or manual stock entries
    await runAs(assignedUserId, async () => {
      const readRes = await db.query<{ count: number }>(
        `select count(*)::int as count from consumable_movements where organization_id = $1`,
        [orgId],
      );
      assert.ok(readRes.rows[0].count >= 1);
    });
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into consumable_items (organization_id, name, unit) values ($1, 'Unauthorized', 'pcs')`,
            [orgId],
          ),
        ),
      /row-level security/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into consumable_movements (organization_id, item_id, site_name, movement_type, quantity_delta)
             values ($1, $2, 'Well 4 BAR', 'delivery', 10)`,
            [orgId, clGranId],
          ),
        ),
      /row-level security/i,
    );

    // 22c. Operator real chlorine_refill & fuel logs auto-sync stock; sample logs do not
    let clActId = '';
    let sampleClActId = '';
    let distActId = '';
    let refillActId = '';
    let directRefillActId = '';
    let purchaseActId = '';

    await runAs(assignedUserId, async () => {
      const r1 = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'chlorine_refill', '2026-11-24', 'Well 4 BAR', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ chemicalType: 'Calcium Hypochlorite 70% (granules)', amountAdded: 4.5, amountUnit: 'kg' })],
      );
      clActId = r1.rows[0].id;

      const rDist = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'genset_fuel_distribution', '2026-11-25', 'Depot', $3::jsonb, false) returning id`,
        [
          orgId,
          assignedUserId,
          JSON.stringify({
            fuelType: 'Diesel',
            fuelDistributions: [
              { destinationSite: 'Well 4 BAR', liters: 40 },
              { destinationSite: 'Well 6 PR2', liters: 20 },
            ],
          }),
        ],
      );
      distActId = rDist.rows[0].id;

      const rRefill = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'genset_fuel_refill', '2026-11-25', 'Well 4 BAR', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ fuelType: 'Diesel', fuelSource: 'Stock Drum / Container', litersAdded: 15 })],
      );
      refillActId = rRefill.rows[0].id;

      const rDirect = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'genset_fuel_refill', '2026-11-25', 'Well 4 BAR', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ fuelType: 'Diesel', fuelSource: 'Direct Purchase', litersAdded: 30 })],
      );
      directRefillActId = rDirect.rows[0].id;

      const rPurch = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'genset_fuel_purchase', '2026-11-25', 'Pavia Plant', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ fuelType: 'Gasoline', litersPurchased: 25, receiptNumber: 'OR-991' })],
      );
      purchaseActId = rPurch.rows[0].id;
    }, true);

    await runAs(mgr1Id, async () => {
      const rSample = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'chlorine_refill', '2026-11-24', 'Well 4 BAR', $3::jsonb, true) returning id`,
        [orgId, mgr1Id, JSON.stringify({ chemicalType: 'Calcium Hypochlorite 70% (granules)', amountAdded: 99, amountUnit: 'kg' })],
      );
      sampleClActId = rSample.rows[0].id;
    }, true);

    // Update chlorine_refill from 4.5 -> 6.0 kg as admin and verify old -4.5 row is replaced
    await runAs(adminId, async () => {
      await db.query(
        `update daily_activities set details = $2::jsonb where id = $1`,
        [clActId, JSON.stringify({ chemicalType: 'Calcium Hypochlorite 70% (granules)', amountAdded: 6, amountUnit: 'kg' })],
      );
    }, true);

    await setAuthUid(db, null);
    const sampleMoves = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from consumable_movements where activity_id in ($1, $2)`,
      [sampleClActId, directRefillActId],
    );
    assert.equal(sampleMoves.rows[0].cnt, 0);

    const clBal = await db.query<{ total: string }>(
      `select sum(quantity_delta)::text as total from consumable_movements
       where organization_id = $1 and item_id = $2 and lower(btrim(site_name)) = 'well 4 bar'`,
      [orgId, clGranId],
    );
    assert.equal(Number(clBal.rows[0].total), 44); // 50 opening - 6 updated chlorine_refill

    const dieselWell4 = await db.query<{ total: string }>(
      `select sum(quantity_delta)::text as total from consumable_movements
       where organization_id = $1 and item_id = $2 and lower(btrim(site_name)) = 'well 4 bar'`,
      [orgId, dieselId],
    );
    assert.equal(Number(dieselWell4.rows[0].total), 25); // +40 distributed - 15 stock drum refill

    const gasPavia = await db.query<{ total: string; ref: string | null }>(
      `select sum(quantity_delta)::text as total, max(reference_no) as ref from consumable_movements
       where organization_id = $1 and item_id = $2 and lower(btrim(site_name)) = 'pavia plant'`,
      [orgId, gasId],
    );
    assert.equal(Number(gasPavia.rows[0].total), 25);
    assert.equal(gasPavia.rows[0].ref, 'OR-991');

    // Deleting an activity cascades cleanly and removes its auto movements
    assert.ok(distActId && refillActId && purchaseActId);
    await db.query(`delete from daily_activities where id = $1`, [distActId]);
    const distMovesAfterDel = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from consumable_movements where activity_id = $1`,
      [distActId],
    );
    assert.equal(distMovesAfterDel.rows[0].cnt, 0);

    // Re-running 039 migration is idempotent
    await db.exec(sql39);

    // 23. 040 Field Integrity & Inventory Hardening
    const sql40 = fs.readFileSync(path.join(MIGRATIONS_DIR, '040_field_integrity_and_inventory_hardening.sql'), 'utf8');
    await db.exec(sql40);

    // 23a. Operator cannot delete verified or flagged logs, while submitted & admin deletes work
    let opFuelActId = '';
    let opFlaggedActId = '';
    let opSubmittedActId = '';
    await runAs(assignedUserId, async () => {
      const rFuel = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'genset_fuel_refill', '2026-11-26', 'Well 4 BAR', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ fuelType: 'Diesel', fuelSource: 'Stock Drum / Container', litersAdded: 50 })],
      );
      opFuelActId = rFuel.rows[0].id;

      const rFlagged = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
         values ($1, $2, 'chlorine_refill', '2026-11-26', 'Well 4 BAR', $3::jsonb, false) returning id`,
        [orgId, assignedUserId, JSON.stringify({ chemicalType: 'Calcium Hypochlorite 70% (granules)', amountAdded: 2, amountUnit: 'kg' })],
      );
      opFlaggedActId = rFlagged.rows[0].id;

      const rDraft = await db.query<{ id: string }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, status, is_sample)
         values ($1, $2, 'pump_inspection', '2026-11-26', 'Well 4 BAR', 'submitted', false) returning id`,
        [orgId, assignedUserId],
      );
      opSubmittedActId = rDraft.rows[0].id;
    }, true);

    // Capture movement id before verifying so we also assert zero stock churn on status update
    const preVerifyMove = await db.query<{ id: string }>(
      `select id from consumable_movements where activity_id = $1`,
      [opFuelActId],
    );
    assert.equal(preVerifyMove.rowCount, 1);
    const fuelMoveId = preVerifyMove.rows[0].id;

    // Admin verifies opFuelActId & flags opFlaggedActId
    await runAs(adminId, async () => {
      await db.query(
        `update daily_activities set status = 'verified', verified_by = $2, verified_at = now() where id = $1`,
        [opFuelActId, adminId],
      );
      await db.query(
        `update daily_activities set status = 'flagged', verified_by = $2, verified_at = now(), review_note = 'Check reading' where id = $1`,
        [opFlaggedActId, adminId],
      );
    }, true);

    const postVerifyMove = await db.query<{ id: string }>(
      `select id from consumable_movements where activity_id = $1`,
      [opFuelActId],
    );
    assert.equal(postVerifyMove.rows[0]?.id, fuelMoveId, 'Verifying must not delete and recreate stock movements');

    // Operator DELETE on verified or flagged log deletes 0 rows; submitted log still deletes
    await runAs(assignedUserId, async () => {
      const delVerified = await db.query(`delete from daily_activities where id = $1`, [opFuelActId]);
      assert.equal(delVerified.rowCount, 0);

      const delFlagged = await db.query(`delete from daily_activities where id = $1`, [opFlaggedActId]);
      assert.equal(delFlagged.rowCount, 0);

      const delSubmitted = await db.query(`delete from daily_activities where id = $1`, [opSubmittedActId]);
      assert.equal(delSubmitted.rowCount, 1);
    }, true);

    // Verified 50L deduction & flagged row remain intact
    await setAuthUid(db, null);
    const intactMove = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from consumable_movements where activity_id = $1`,
      [opFuelActId],
    );
    assert.equal(intactMove.rows[0].cnt, 1);

    // Admin can still delete verified/flagged rows (clean up test rows so cumulative balances match)
    await runAs(adminId, async () => {
      const adminDel1 = await db.query(`delete from daily_activities where id = $1`, [opFuelActId]);
      const adminDel2 = await db.query(`delete from daily_activities where id = $1`, [opFlaggedActId]);
      assert.equal(adminDel1.rowCount, 1);
      assert.equal(adminDel2.rowCount, 1);
    }, true);

    // 23b. Server-controlled received_at resists backdating while preserving device created_at
    await setAuthUid(db, null);
    let backdatedId = '';
    await runAs(assignedUserId, async () => {
      const backRes = await db.query<{ id: string; created_at: string; received_at: string; diff_days: number }>(
        `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, created_at, received_at, is_sample)
         values ($1, $2, 'pump_inspection', '2026-08-01', 'Well 4 BAR', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', false)
         returning id, created_at::text, received_at::text, extract(epoch from (received_at - created_at)) / 86400.0 as diff_days`,
        [orgId, assignedUserId],
      );
      backdatedId = backRes.rows[0].id;
      assert.ok(backRes.rows[0].created_at.startsWith('2026-08-01'));
      assert.ok(backRes.rows[0].diff_days > 30, 'Server received_at must ignore backdated client value');

      const updRes = await db.query<{ same_receipt: boolean }>(
        `update daily_activities set notes = 'edited', received_at = '2020-01-01T00:00:00Z'
         where id = $1 returning received_at > '2026-09-01T00:00:00Z'::timestamptz as same_receipt`,
        [backdatedId],
      );
      assert.equal(updRes.rows[0].same_receipt, true);
    }, true);

    // 23c. seed_default_consumables(uuid) locked down from public/anon/authenticated, triggers still work
    await setAuthUid(db, null);
    const seedPriv = await db.query<{ pub: boolean; anon: boolean; auth: boolean; svc: boolean }>(
      `select
         has_function_privilege('public', 'seed_default_consumables(uuid)', 'EXECUTE') as pub,
         has_function_privilege('anon', 'seed_default_consumables(uuid)', 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'seed_default_consumables(uuid)', 'EXECUTE') as auth,
         has_function_privilege('service_role', 'seed_default_consumables(uuid)', 'EXECUTE') as svc`,
    );
    assert.deepEqual(seedPriv.rows[0], { pub: false, anon: false, auth: false, svc: true });

    await db.exec('begin; set local role anon;');
    await assert.rejects(() => db.query(`select seed_default_consumables($1)`, [orgId]), /permission denied/i);
    await db.exec('rollback;');

    await setAuthUid(db, assignedUserId);
    await db.exec('begin; set local role authenticated;');
    await assert.rejects(() => db.query(`select seed_default_consumables($1)`, [orgId]), /permission denied/i);
    await db.exec('rollback;');

    await setAuthUid(db, null);
    const seededOrgRes = await db.query<{ id: string }>(
      `insert into organizations (name) values ('Triggered Org Test') returning id`,
    );
    const triggeredSeedCount = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from consumable_items where organization_id = $1`,
      [seededOrgRes.rows[0].id],
    );
    assert.equal(triggeredSeedCount.rows[0].cnt, 4);

    // 23d. Reject comma quantities, ambiguous chlorine types, and unrecognized fuel types
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
             values ($1, $2, 'genset_fuel_refill', '2026-11-26', 'Well 4 BAR', $3::jsonb, false)`,
            [orgId, assignedUserId, JSON.stringify({ fuelType: 'Diesel', fuelSource: 'Stock Drum / Container', litersAdded: '1,000' })],
          ),
        ),
      /Invalid consumable quantity/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
             values ($1, $2, 'genset_fuel_refill', '2026-11-26', 'Well 4 BAR', $3::jsonb, false)`,
            [orgId, assignedUserId, JSON.stringify({ fuelType: 'Kerosene', fuelSource: 'Stock Drum / Container', litersAdded: 10 })],
          ),
        ),
      /Unrecognized fuelType/i,
    );
    await assert.rejects(
      () =>
        runAs(assignedUserId, () =>
          db.query(
            `insert into daily_activities (organization_id, logged_by, activity_type, activity_date, site_or_well, details, is_sample)
             values ($1, $2, 'chlorine_refill', '2026-11-26', 'Well 4 BAR', $3::jsonb, false)`,
            [orgId, assignedUserId, JSON.stringify({ chemicalType: 'Unclear Chemical', amountAdded: 5, amountUnit: 'kg' })],
          ),
        ),
      /Unrecognized chlorine chemicalType/i,
    );

    // 23e. DB balance aggregation RPC returns accurate org-scoped balances for authenticated users
    await setAuthUid(db, null);
    const rpcPriv = await db.query<{ anon: boolean; auth: boolean }>(
      `select
         has_function_privilege('anon', 'get_consumable_site_balances()', 'EXECUTE') as anon,
         has_function_privilege('authenticated', 'get_consumable_site_balances()', 'EXECUTE') as auth`,
    );
    assert.deepEqual(rpcPriv.rows[0], { anon: false, auth: true });

    await runAs(assignedUserId, async () => {
      const balRows = await db.query<{ site_key: string; item_id: string; balance: string }>(
        `select site_key, item_id::text, balance::text from get_consumable_site_balances()`,
      );
      const byCell = new Map(balRows.rows.map((r) => [`${r.site_key}::${r.item_id}`, Number(r.balance)]));
      assert.equal(byCell.get(`well 4 bar::${clGranId}`), 44);
      assert.equal(byCell.get(`well 4 bar::${dieselId}`), -15); // distActId (+40) deleted above, leaving refillActId (-15)
      assert.equal(byCell.get(`pavia plant::${gasId}`), 25);
    });

    // Re-running 040 migration is idempotent
    await db.exec(sql40);
  });
});
