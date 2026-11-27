import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const SERVER_ROW_CAP = 1000;

type Row = {
  id: string;
  organization_id: string;
  activity_type: string;
  status: 'draft' | 'submitted' | 'verified' | 'flagged';
  photo_hold: boolean;
  photo_storage_paths: string[];
  photo_urls: string[];
  photos_expires_at: string | null;
  created_at: string;
  purged: boolean;
};

let rows: Row[] = [];
let failingPaths = new Set<string>();
let serverCap = SERVER_ROW_CAP;
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let piiRpcResult: { data: unknown; error: { message: string } | null } = {
  data: [{ activities_scrubbed: 2, job_orders_scrubbed: 1 }],
  error: null,
};

/** In-memory stand-in for the parts of PostgREST + Storage the purge uses. Rows are in created_at order. */
function fakeDb() {
  return {
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'purge_expired_telemetry_pii') return piiRpcResult;
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => ({
          error: paths.some((p) => failingPaths.has(p)) ? { message: 'boom' } : null,
        }),
      }),
    },
    from: (table: string) => {
      let mediaOnly = false;
      let ids: string[] | null = null;
      const q = {
        select: () => {
          if (!ids) return q;
          const hit = rows.filter((r) => ids!.includes(r.id));
          hit.forEach((r) => Object.assign(r, { purged: true, photo_storage_paths: [], photo_urls: [] }));
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
        is: () => q,
        eq: () => q,
        or: (filter: string) => {
          if (filter === 'photo_storage_paths.neq.{},photo_urls.neq.{}') mediaOnly = true;
          return q;
        },
        order: () => q,
        limit: () => q,
        update: () => q,
        delete: () => q,
        in: (_col: string, value: string[]) => {
          ids = value;
          return q;
        },
        range: async (from: number, to: number) => {
          const matching = rows.filter(
            (r) => !r.purged && (!mediaOnly || r.photo_storage_paths.length > 0 || r.photo_urls.length > 0),
          );
          return { data: matching.slice(from, Math.min(to + 1, from + serverCap)), error: null };
        },
        // The sample-photo queue is empty in these tests.
        then: (resolve: (v: unknown) => unknown) => resolve({ data: table === 'sample_photo_cleanup' ? [] : null, error: null }),
      };
      return q;
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => fakeDb() }));
vi.mock('@/lib/supabase/env', () => ({ getSupabaseEnv: () => ({ url: 'http://db.test', key: 'k', isConfigured: true }) }));

const path = (n: number) => `${ORG}/2026-01-01/photo-${n}.webp`;
const DAY_MS = 24 * 60 * 60 * 1000;
const makeRow = (n: number, withPhoto: boolean, overrides: Partial<Row> = {}): Row => ({
  id: `row-${n}`,
  organization_id: ORG,
  activity_type: 'pump_monitoring',
  status: 'submitted',
  photo_hold: false,
  photo_storage_paths: withPhoto ? [path(n)] : [],
  photo_urls: [],
  photos_expires_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
  created_at: new Date(Date.now() - 35 * DAY_MS).toISOString(),
  purged: false,
  ...overrides,
});

async function runCron() {
  const { GET } = await import('@/app/api/activities/purge-photos/route');
  const res = await GET(new Request('http://app.test/api/activities/purge-photos', { headers: { authorization: 'Bearer s3cret' } }));
  return { status: res.status, body: await res.json() };
}

describe('purge-photos cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret';
    process.env.SUPABASE_SECRET_KEY = 'service';
    failingPaths = new Set();
    serverCap = SERVER_ROW_CAP;
    rpcCalls = [];
    piiRpcResult = { data: [{ activities_scrubbed: 2, job_orders_scrubbed: 1 }], error: null };
  });

  it('is not starved by more than a full response of photo-less expired logs', async () => {
    rows = Array.from({ length: 1520 }, (_, i) => makeRow(i, i >= 1500));
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body).toMatchObject({ purgedCount: 20, hasMore: false });
    expect(rows.filter((r) => r.photo_storage_paths.length > 0)).toHaveLength(0);
  });

  it('keeps going past a batch whose storage removal fails', async () => {
    rows = Array.from({ length: 250 }, (_, i) => makeRow(i, true));
    failingPaths = new Set([path(0)]);
    const { status, body } = await runCron();
    expect(status).toBe(200);
    // The first chunk of 100 files fails as a unit and is left for the next run.
    expect(body).toMatchObject({ purgedCount: 150, skippedRows: 100, hasMore: false });
    expect(rows[0].purged).toBe(false);
  });

  it('processes every row when the server caps responses below the batch size', async () => {
    rows = Array.from({ length: 130 }, (_, i) => makeRow(i, true));
    serverCap = 40;
    const { body } = await runCron();
    expect(body).toMatchObject({ purgedCount: 130, hasMore: false });
  });

  it('reports an error when nothing could be removed', async () => {
    rows = [makeRow(1, true)];
    failingPaths = new Set([path(1)]);
    const { status } = await runCron();
    expect(status).toBe(500);
  });

  it('skips flagged and held logs under 365 days while purging >365d logs and invoking telemetry PII purge', async () => {
    rows = [
      makeRow(1, true, { status: 'flagged', created_at: new Date(Date.now() - 200 * DAY_MS).toISOString() }),
      makeRow(2, true, { photo_hold: true, created_at: new Date(Date.now() - 200 * DAY_MS).toISOString() }),
      makeRow(3, true, { status: 'flagged', photo_hold: true, created_at: new Date(Date.now() - 370 * DAY_MS).toISOString() }),
      makeRow(4, true),
    ];
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      purgedCount: 2,
      heldOrFlaggedSkipped: 2,
      telemetryPiiPurged: { activities_scrubbed: 2, job_orders_scrubbed: 1 },
    });
    expect(rows[0].purged).toBe(false);
    expect(rows[1].purged).toBe(false);
    expect(rows[2].purged).toBe(true);
    expect(rows[3].purged).toBe(true);
    expect(rpcCalls.some((c) => c.fn === 'purge_expired_telemetry_pii')).toBe(true);
  });

  it('returns 500 if telemetry PII purge fails during cron execution', async () => {
    rows = [];
    piiRpcResult = { data: null, error: { message: 'rpc failed' } };
    const { status, body } = await runCron();
    expect(status).toBe(500);
    expect(body.error).toMatch(/Telemetry PII purge failed/);
  });
});
