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

describe('PGlite SQL migrations 001–021 execution & security invariants', () => {
  it('executes all 001–021 migrations cleanly and enforces sign-up, change-request, storage, and org-seed hardening', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await initSupabaseShim(db);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    assert.ok(files.length >= 21, `Expected >= 21 migrations, found ${files.length}`);

    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await db.exec(sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.fail(`Migration ${f} failed in PGlite: ${msg}`);
      }
    }

    // 1. 019 Sign-up approval: first user -> active admin; second user -> inactive viewer + admin notification
    const adminId = '11111111-1111-4111-8111-111111111111';
    const mgr1Id = '22222222-2222-4222-8222-222222222222';
    const mgrApproverId = '33333333-3333-4333-8333-333333333333';

    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'admin@bpwi.test', $2::jsonb)`, [
      adminId,
      JSON.stringify({ full_name: 'Admin User' }),
    ]);
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
  });
});
