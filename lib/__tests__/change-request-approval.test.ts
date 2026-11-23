import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase', 'migrations');

async function bootDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth; create schema if not exists storage;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz not null default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
  `);
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('approve/reject change request: conflicts, overrides, partial flow (023)', () => {
  it('behaves correctly across conflict, override and partial-approval paths', async () => {
    const db = await bootDb();
    const ADMIN = '11111111-1111-4111-8111-111111111111';
    const HEAD = '22222222-2222-4222-8222-222222222222';
    const uid = (u: string) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);

    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'a@t','{"full_name":"Admin"}'::jsonb)`, [ADMIN]);
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'h@t','{"full_name":"Head"}'::jsonb)`, [HEAD]);
    await db.query(`update user_profiles set role='manager', is_active=true where id=$1`, [HEAD]);
    const org = (await db.query<{ o: string }>(`select organization_id o from user_profiles where id=$1`, [ADMIN])).rows[0].o;
    const op = (await db.query<{ id: string }>(`insert into operators (organization_id,full_name) values ($1,'Op') returning id`, [org])).rows[0].id;
    const shift = async (code: string) =>
      (await db.query<{ id: string }>(`insert into shift_types (organization_id,code,duration_hours) values ($1,$2,8) returning id`, [org, code])).rows[0].id;
    const s1 = await shift('7-4');
    const s2 = await shift('10-7');
    const s3 = await shift('1-10');

    type Item = { sql: string; args: unknown[] };
    const sched = (date: string, shiftId: string, orig: object | null): Item => ({
      sql: `insert into change_request_items (request_id,organization_id,target_table,action,operator_id,schedule_date,shift_type_id,original_state)
            values ($1,$2,'schedule_assignments','upsert',$3,$4,$5,$6::jsonb) returning id`,
      args: [op, date, shiftId, orig ? JSON.stringify(orig) : null],
    });
    async function mkReq(items: Item[]) {
      await uid(HEAD);
      const r = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'t') returning id`, [org, HEAD])).rows[0].id;
      const ids: string[] = [];
      for (const it of items) ids.push((await db.query<{ id: string }>(it.sql, [r, org, ...it.args])).rows[0].id);
      await db.query(`select submit_change_request($1,'note')`, [r]);
      await uid(ADMIN);
      return { r, ids };
    }
    const approve = async (r: string, ids: string[] | null, rej: string[] | null, note: string | null, force = false) =>
      (await db.query<{ res: Record<string, number | string> }>(`select approve_change_request($1,$2::uuid[],$3::uuid[],$4,$5,false) res`, [r, ids, rej, note, force])).rows[0].res;
    const header = async (r: string) =>
      (await db.query<{ status: string; reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null }>(
        `select status, reviewed_by, reviewed_at, review_notes from change_requests where id=$1`, [r])).rows[0];

    // A. proposal on an EMPTY cell (original_state null) must conflict if someone fills the cell meanwhile
    {
      const { r } = await mkReq([sched('2026-12-01', s1, null)]);
      await db.query(`insert into schedule_assignments (organization_id,operator_id,schedule_date,shift_type_id) values ($1,$2,'2026-12-01',$3)`, [org, op, s2]);
      const res = await approve(r, null, null, null);
      assert.equal(res.conflict_count, 1);
      assert.equal(res.approved_count, 0);
      const live = (await db.query<{ shift_type_id: string }>(`select shift_type_id from schedule_assignments where operator_id=$1 and schedule_date='2026-12-01'`, [op])).rows[0];
      assert.equal(live.shift_type_id, s2, 'live cell must be untouched');
      // empty cell proposal with a still-empty cell applies normally
      const ok = await mkReq([sched('2026-12-09', s1, null)]);
      assert.equal((await approve(ok.r, null, null, null)).approved_count, 1);
    }

    // B. conflict-only attempt must not stamp the request as reviewed
    {
      const { r } = await mkReq([sched('2026-12-02', s1, { shift_type_id: s2, area_code_id: null })]);
      await db.query(`insert into schedule_assignments (organization_id,operator_id,schedule_date,shift_type_id) values ($1,$2,'2026-12-02',$3)`, [org, op, s3]);
      const res = await approve(r, null, null, 'Looks fine');
      assert.equal(res.conflict_count, 1);
      const h = await header(r);
      assert.equal(h.status, 'pending');
      assert.equal(h.reviewed_by, null);
      assert.equal(h.reviewed_at, null);
      assert.equal(h.review_notes, null);
    }

    // C. override of a changed cell applies; override of a deleted PM task discards instead of recreating
    {
      const { r, ids } = await mkReq([sched('2026-12-03', s1, { shift_type_id: s2, area_code_id: null })]);
      await db.query(`insert into schedule_assignments (organization_id,operator_id,schedule_date,shift_type_id) values ($1,$2,'2026-12-03',$3)`, [org, op, s3]);
      assert.equal((await approve(r, ids, null, null)).conflict_count, 1);
      assert.equal((await approve(r, ids, null, 'Override ok', true)).approved_count, 1);
      assert.equal((await header(r)).status, 'approved');

      const t = (await db.query<{ id: string }>(`insert into pm_tasks (organization_id,title,activity_type,scheduled_date,status) values ($1,'Orig','maintenance','2026-12-04','planned') returning id`, [org])).rows[0].id;
      const pm = await mkReq([{
        sql: `insert into change_request_items (request_id,organization_id,target_table,action,schedule_date,pm_task_id,pm_title,pm_status,original_state)
              values ($1,$2,'pm_tasks','upsert','2026-12-04',$3,'Renamed','planned',$4::jsonb) returning id`,
        args: [t, JSON.stringify({ title: 'Orig', status: 'planned', scheduled_date: '2026-12-04' })],
      }]);
      await db.query(`delete from pm_tasks where id=$1`, [t]);
      assert.equal((await approve(pm.r, null, null, null)).conflict_count, 1);
      const forced = await approve(pm.r, null, null, null, true);
      assert.equal(forced.approved_count, 0);
      assert.equal(forced.rejected_count, 1);
      const n = (await db.query<{ n: number }>(`select count(*)::int n from pm_tasks where organization_id=$1`, [org])).rows[0].n;
      assert.equal(n, 0, 'a deleted PM task must not be re-created by an override');
      const it = (await db.query<{ status: string; rejection_reason: string }>(`select status, rejection_reason from change_request_items where id=$1`, [pm.ids[0]])).rows[0];
      assert.equal(it.status, 'rejected');
      assert.match(it.rejection_reason, /no longer exists/i);
    }

    // D. partial flow: approve one, reject one by id, leave one open; notes accumulate; requester notified
    {
      const { r, ids } = await mkReq([sched('2026-12-05', s1, null), sched('2026-12-06', s1, null), sched('2026-12-07', s1, null)]);
      const b1 = await approve(r, [ids[0]], null, 'Batch 1');
      assert.equal(b1.status, 'partially_approved');
      const b2 = await approve(r, [], [ids[1]], 'Not this one');
      assert.equal(b2.rejected_count, 1);
      assert.equal(b2.remaining_pending_count, 1);
      assert.equal((await header(r)).review_notes, 'Batch 1\nNot this one');
      const notifs = (await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id=$1 and kind='request_partially_approved'`, [HEAD])).rows[0].n;
      assert.ok(notifs >= 2, 'requester is notified on later review activity of a partially approved request');
      await db.query(`select reject_change_request($1,'Out of scope')`, [r]);
      const h = await header(r);
      assert.equal(h.status, 'partially_approved');
      assert.match(h.review_notes ?? '', /^Batch 1\nNot this one\nRemaining items rejected: Out of scope$/);
    }
  });

  it('enforces approve_change_request & reject_change_request regression guards across all migrations', async () => {
    const db = await bootDb();
    const ADMIN = '11111111-1111-4111-8111-111111111111';
    const HEAD = '22222222-2222-4222-8222-222222222222';
    const HEAD_NO_APPROVE = '33333333-3333-4333-8333-333333333333';
    const OPERATOR = '44444444-4444-4444-8444-444444444444';
    const VIEWER = '55555555-5555-4555-8555-555555555555';
    const OTHER_ADMIN = '66666666-6666-4666-8666-666666666666';
    const uid = (u: string) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);

    // 1. Privilege & definition guards (no re-opening to anon/public, retains row lock & RPC flag)
    const priv = await db.query<{
      ap_pub: boolean; ap_anon: boolean; ap_auth: boolean;
      rj_pub: boolean; rj_anon: boolean; rj_auth: boolean;
      ap_def: string;
    }>(`
      select
        has_function_privilege('public', 'approve_change_request(uuid,uuid[],uuid[],text,boolean,boolean)', 'EXECUTE') as ap_pub,
        has_function_privilege('anon', 'approve_change_request(uuid,uuid[],uuid[],text,boolean,boolean)', 'EXECUTE') as ap_anon,
        has_function_privilege('authenticated', 'approve_change_request(uuid,uuid[],uuid[],text,boolean,boolean)', 'EXECUTE') as ap_auth,
        has_function_privilege('public', 'reject_change_request(uuid,text)', 'EXECUTE') as rj_pub,
        has_function_privilege('anon', 'reject_change_request(uuid,text)', 'EXECUTE') as rj_anon,
        has_function_privilege('authenticated', 'reject_change_request(uuid,text)', 'EXECUTE') as rj_auth,
        pg_get_functiondef('approve_change_request(uuid,uuid[],uuid[],text,boolean,boolean)'::regprocedure) as ap_def
    `);
    assert.equal(priv.rows[0].ap_pub, false);
    assert.equal(priv.rows[0].ap_anon, false);
    assert.equal(priv.rows[0].ap_auth, true);
    assert.equal(priv.rows[0].rj_pub, false);
    assert.equal(priv.rows[0].rj_anon, false);
    assert.equal(priv.rows[0].rj_auth, true);
    assert.match(priv.rows[0].ap_def, /for update/i);
    assert.match(priv.rows[0].ap_def, /app\.change_request_rpc/i);

    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'a@t','{"full_name":"Admin"}'::jsonb)`, [ADMIN]);
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'h@t','{"full_name":"Head"}'::jsonb)`, [HEAD]);
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'hn@t','{"full_name":"Head NoApprove"}'::jsonb)`, [HEAD_NO_APPROVE]);
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'o@t','{"full_name":"Op"}'::jsonb)`, [OPERATOR]);
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'v@t','{"full_name":"Viewer"}'::jsonb)`, [VIEWER]);
    await db.query(`update user_profiles set role='manager', is_active=true, can_approve=true where id=$1`, [HEAD]);
    await db.query(`update user_profiles set role='manager', is_active=true, can_approve=false where id=$1`, [HEAD_NO_APPROVE]);
    await db.query(`update user_profiles set role='operator', is_active=true where id=$1`, [OPERATOR]);
    await db.query(`update user_profiles set role='viewer', is_active=true where id=$1`, [VIEWER]);

    const org = (await db.query<{ o: string }>(`select organization_id o from user_profiles where id=$1`, [ADMIN])).rows[0].o;
    const org2 = (await db.query<{ id: string }>(`insert into organizations (name) values ('Second Org') returning id`)).rows[0].id;
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'a2@t','{"full_name":"Other Admin"}'::jsonb)`, [OTHER_ADMIN]);
    await db.query(`update user_profiles set organization_id=$2, role='admin', is_active=true where id=$1`, [OTHER_ADMIN, org2]);

    const op = (await db.query<{ id: string }>(`insert into operators (organization_id,full_name) values ($1,'Op 1') returning id`, [org])).rows[0].id;
    const op2 = (await db.query<{ id: string }>(`insert into operators (organization_id,full_name) values ($1,'Op 2') returning id`, [org])).rows[0].id;
    const s1 = (await db.query<{ id: string }>(`insert into shift_types (organization_id,code,duration_hours) values ($1,'7-4',8) returning id`, [org])).rows[0].id;

    // Seed pending request submitted by HEAD
    await uid(HEAD);
    const reqId = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'Guard Test') returning id`, [org, HEAD])).rows[0].id;
    await db.query(
      `insert into change_request_items (request_id,organization_id,target_table,action,operator_id,schedule_date,shift_type_id)
       values ($1,$2,'schedule_assignments','upsert',$3,'2026-12-20',$4)`,
      [reqId, org, op, s1],
    );
    await db.query(`select submit_change_request($1,'please review')`, [reqId]);

    // 2. Role & cross-org authorization checks
    for (const actor of [OPERATOR, VIEWER, HEAD_NO_APPROVE]) {
      await uid(actor);
      await assert.rejects(() => db.query(`select approve_change_request($1)`, [reqId]), /Permission denied/i);
      await assert.rejects(() => db.query(`select reject_change_request($1, 'no')`, [reqId]), /Permission denied/i);
    }
    await uid(OTHER_ADMIN);
    await assert.rejects(() => db.query(`select approve_change_request($1)`, [reqId]), /Change request not found/i);
    await assert.rejects(() => db.query(`select reject_change_request($1, 'cross org')`, [reqId]), /Change request not found/i);

    // 3. Self-approval & self-rejection guards (delegated manager never allowed even with p_allow_self_override = true)
    await uid(HEAD);
    await assert.rejects(
      () => db.query(`select approve_change_request($1, null, null, null, false, true)`, [reqId]),
      /cannot approve their own change requests/i,
    );
    await assert.rejects(
      () => db.query(`select reject_change_request($1, 'self')`, [reqId]),
      /cannot reject their own change requests/i,
    );

    // 4. Draft request cannot be approved or rejected prematurely; direct table status mutation blocked
    await uid(HEAD);
    const draftId = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title,status) values ($1,$2,'Draft Req','draft') returning id`, [org, HEAD])).rows[0].id;
    await uid(ADMIN);
    await assert.rejects(() => db.query(`select approve_change_request($1)`, [draftId]), /not open for approval \(current status: draft\)/i);
    await assert.rejects(() => db.query(`select reject_change_request($1, 'nope')`, [draftId]), /Cannot reject change request in draft status/i);
    await assert.rejects(() => db.query(`update change_requests set status='approved' where id=$1`, [reqId]), /only be changed through approve_change_request/i);

    // Terminal statuses (approved, rejected, cancelled) cannot be re-processed
    await db.query(`select approve_change_request($1)`, [reqId]);
    await assert.rejects(() => db.query(`select approve_change_request($1)`, [reqId]), /not open for approval \(current status: approved\)/i);
    await assert.rejects(() => db.query(`select reject_change_request($1, 'after')`, [reqId]), /Cannot reject change request in approved status/i);

    await uid(HEAD);
    const rejReqId = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'Reject Me') returning id`, [org, HEAD])).rows[0].id;
    await db.query(`insert into change_request_items (request_id,organization_id,target_table,action,operator_id,schedule_date,shift_type_id) values ($1,$2,'schedule_assignments','upsert',$3,'2026-12-21',$4)`, [rejReqId, org, op, s1]);
    await db.query(`select submit_change_request($1,null)`, [rejReqId]);
    await uid(ADMIN);
    await db.query(`select reject_change_request($1, 'Declined')`, [rejReqId]);
    await assert.rejects(() => db.query(`select approve_change_request($1)`, [rejReqId]), /not open for approval \(current status: rejected\)/i);
    await assert.rejects(() => db.query(`select reject_change_request($1, 'Again')`, [rejReqId]), /Cannot reject change request in rejected status/i);

    // 5. Additional 023 conflict cases: standby empty-cell, deleted leave, leave date range, PM assigned_operator_ids & orphaned PM task
    await uid(HEAD);
    const advReqId = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'Adv Conflicts') returning id`, [org, HEAD])).rows[0].id;
    const leaveDelId = (await db.query<{ id: string }>(`insert into leave_records (organization_id,operator_id,leave_code,start_date,end_date) values ($1,$2,'VL','2027-01-10','2027-01-11') returning id`, [org, op])).rows[0].id;
    const pmAssignId = (await db.query<{ id: string }>(`insert into pm_tasks (organization_id,title,activity_type,scheduled_date,assigned_operator_ids,status) values ($1,'Pump Check','maintenance','2027-01-12',array[$2]::uuid[],'planned') returning id`, [org, op])).rows[0].id;

    const sbEmptyIt = (await db.query<{ id: string }>(
      `insert into change_request_items (request_id,organization_id,target_table,action,operator_id,schedule_date,standby_type,original_state)
       values ($1,$2,'standby_assignments','upsert',$3,'2027-01-08','OC',null) returning id`,
      [advReqId, org, op],
    )).rows[0].id;
    const leaveDelIt = (await db.query<{ id: string }>(
      `insert into change_request_items (request_id,organization_id,target_table,target_id,action,operator_id,schedule_date,leave_code,leave_start_date,leave_end_date,original_state)
       values ($1,$2,'leave_records',$3,'upsert',$4,'2027-01-10','SL','2027-01-10','2027-01-12','{"leave_code":"VL","start_date":"2027-01-10","end_date":"2027-01-11"}'::jsonb) returning id`,
      [advReqId, org, leaveDelId, op],
    )).rows[0].id;
    const pmAssignIt = (await db.query<{ id: string }>(
      `insert into change_request_items (request_id,organization_id,target_table,action,schedule_date,pm_task_id,pm_title,pm_status,pm_assigned_operator_ids,original_state)
       values ($1,$2,'pm_tasks','upsert','2027-01-12',$3,'Pump Check','planned',array[$4]::uuid[],$5::jsonb) returning id`,
      [advReqId, org, pmAssignId, op2, JSON.stringify({ title: 'Pump Check', status: 'planned', scheduled_date: '2027-01-12', assigned_operator_ids: [op] })],
    )).rows[0].id;
    const pmOrphanIt = (await db.query<{ id: string }>(
      `insert into change_request_items (request_id,organization_id,target_table,action,schedule_date,pm_task_id,pm_title,pm_status,original_state)
       values ($1,$2,'pm_tasks','upsert','2027-01-13',null,'Orphan','planned','{"title":"Existing"}'::jsonb) returning id`,
      [advReqId, org],
    )).rows[0].id;
    await db.query(`select submit_change_request($1,null)`, [advReqId]);

    // Concurrent external mutations before review
    await uid(ADMIN);
    await db.query(`insert into standby_assignments (organization_id,operator_id,schedule_date,standby_type) values ($1,$2,'2027-01-08','ERP')`, [org, op]);
    await db.query(`delete from leave_records where id=$1`, [leaveDelId]);
    await db.query(`update pm_tasks set assigned_operator_ids = array[$2]::uuid[] where id=$1`, [pmAssignId, op2]);

    const firstTry = (await db.query<{ res: { conflict_count: number; approved_count: number } }>(
      `select approve_change_request($1, array[$2,$3,$4,$5]::uuid[], null, null, false, false) as res`,
      [advReqId, sbEmptyIt, leaveDelIt, pmAssignIt, pmOrphanIt],
    )).rows[0].res;
    assert.equal(firstTry.conflict_count, 4);
    assert.equal(firstTry.approved_count, 0);

    // Override discards deleted leave + orphan PM task cleanly while forcing live standby/PM updates
    const forcedTry = (await db.query<{ res: { approved_count: number; rejected_count: number } }>(
      `select approve_change_request($1, array[$2,$3,$4,$5]::uuid[], null, 'Force resolution', true, false) as res`,
      [advReqId, sbEmptyIt, leaveDelIt, pmAssignIt, pmOrphanIt],
    )).rows[0].res;
    assert.equal(forcedTry.approved_count, 2); // standby + pmAssign
    assert.equal(forcedTry.rejected_count, 2); // deleted leave + orphan PM task
    const recreatedLeave = (await db.query<{ n: number }>(`select count(*)::int n from leave_records where operator_id=$1 and start_date='2027-01-10'`, [op])).rows[0].n;
    assert.equal(recreatedLeave, 0, 'deleted leave_records row must not be recreated on override');

    // Invalid leave range fails fast
    await uid(HEAD);
    const badLeaveReq = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'Bad Leave Range') returning id`, [org, HEAD])).rows[0].id;
    await db.query(
      `insert into change_request_items (request_id,organization_id,target_table,action,operator_id,schedule_date,leave_code,leave_start_date,leave_end_date)
       values ($1,$2,'leave_records','upsert',$3,'2027-02-05','VL','2027-02-10','2027-02-05')`,
      [badLeaveReq, org, op],
    );
    await db.query(`select submit_change_request($1,null)`, [badLeaveReq]);
    await uid(ADMIN);
    await assert.rejects(() => db.query(`select approve_change_request($1)`, [badLeaveReq]), /Invalid leave date range/i);

    // Deleting a leave_records row must still allow reject_change_request to close the request,
    // while explicitly mutating target_id to a foreign org's leave record remains blocked.
    await uid(HEAD);
    const leaveDelRejTarget = (await db.query<{ id: string }>(`insert into leave_records (organization_id,operator_id,leave_code,start_date,end_date) values ($1,$2,'VL','2027-03-01','2027-03-02') returning id`, [org, op])).rows[0].id;
    const rejDelReq = (await db.query<{ id: string }>(`insert into change_requests (organization_id,requester_id,title) values ($1,$2,'Reject Deleted Leave') returning id`, [org, HEAD])).rows[0].id;
    const rejDelItem = (await db.query<{ id: string }>(
      `insert into change_request_items (request_id,organization_id,target_table,target_id,action,operator_id,schedule_date,leave_code,leave_start_date,leave_end_date)
       values ($1,$2,'leave_records',$3,'upsert',$4,'2027-03-01','VL','2027-03-01','2027-03-03') returning id`,
      [rejDelReq, org, leaveDelRejTarget, op],
    )).rows[0].id;
    await db.query(`select submit_change_request($1,null)`, [rejDelReq]);
    await db.query(`delete from leave_records where id=$1`, [leaveDelRejTarget]);
    await uid(ADMIN);
    await db.query(`select reject_change_request($1, 'Target gone')`, [rejDelReq]);
    assert.equal((await db.query<{ status: string }>(`select status from change_requests where id=$1`, [rejDelReq])).rows[0].status, 'rejected');

    const opOrg2 = (await db.query<{ id: string }>(`insert into operators (organization_id,full_name) values ($1,'Other Org Op') returning id`, [org2])).rows[0].id;
    const leaveOrg2 = (await db.query<{ id: string }>(`insert into leave_records (organization_id,operator_id,leave_code,start_date,end_date) values ($1,$2,'VL','2027-03-10','2027-03-11') returning id`, [org2, opOrg2])).rows[0].id;
    await assert.rejects(
      () => db.query(`update change_request_items set target_id=$2 where id=$1`, [rejDelItem, leaveOrg2]),
      /Leave record does not belong to this organization/i,
    );
  });
});
