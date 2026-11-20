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
});
