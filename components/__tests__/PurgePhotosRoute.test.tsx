import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const SERVER_ROW_CAP = 1000;

type Row = { id: string; organization_id: string; photo_storage_paths: string[]; photo_urls: string[]; purged: boolean };

let rows: Row[] = [];
let failingPaths = new Set<string>();
let serverCap = SERVER_ROW_CAP;

/** In-memory stand-in for the parts of PostgREST + Storage the purge uses. Rows are in created_at order. */
function fakeDb() {
  return {
    rpc: async () => ({ data: null, error: null }),
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
const makeRow = (n: number, withPhoto: boolean): Row => ({
  id: `row-${n}`,
  organization_id: ORG,
  photo_storage_paths: withPhoto ? [path(n)] : [],
  photo_urls: [],
  purged: false,
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
});
