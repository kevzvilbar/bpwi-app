import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ORG = '11111111-1111-4111-8111-111111111111';

let authUser: { id: string } | null = { id: 'admin-1' };
let profileRole = 'admin';
let upsertCalls: Array<{ table: string; options: Record<string, unknown> }> = [];
let leaveQueryErrors: Record<string, { message: string } | null> = {};

function makeImportServiceDb() {
  return {
    from: (table: string) => {
      let mode: 'select' | 'upsert' = 'select';
      const q = {
        select: () => {
          if (mode === 'select') return q;
          return Promise.resolve({
            data:
              table === 'area_codes'
                ? [{ id: 'area-1', code: 'PL' }]
                : [{ id: `${table}-1`, legacy_key: table === 'shift_types' ? 's1' : 'k1' }],
            error: null,
          });
        },
        eq: () => {
          if (mode === 'select') {
            return Promise.resolve({
              data:
                table === 'area_codes'
                  ? [{ id: 'area-1', code: 'PL' }]
                  : [{ id: `${table}-1`, legacy_key: table === 'shift_types' ? 's1' : 'k1' }],
              error: null,
            });
          }
          return q;
        },
        upsert: (_rows: unknown, opts: Record<string, unknown>) => {
          mode = 'upsert';
          upsertCalls.push({ table, options: opts });
          if (table === 'schedule_assignments' || table === 'standby_assignments' || table === 'pm_activity_types' || table === 'pm_tasks') {
            return Promise.resolve({ data: [], error: null });
          }
          return q;
        },
      };
      return q;
    },
  };
}

function makeLeaveDb() {
  return {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        gte: () => q,
        lte: () => q,
        order: () => {
          if (table === 'operators' || table === 'area_codes') {
            const err = leaveQueryErrors[table] ?? null;
            const data =
              table === 'operators'
                ? [{ id: 'op-1', full_name: 'Juan' }]
                : [{ id: 'area-sl', code: 'SL', category: 'leave' }];
            return Promise.resolve({ data: err ? null : data, error: err });
          }
          return q;
        },
        range: () => {
          const err = leaveQueryErrors[table] ?? null;
          return Promise.resolve({ data: err ? null : [], error: err });
        },
        then: (resolve: (v: unknown) => unknown) => {
          const err = leaveQueryErrors[table] ?? null;
          if (table === 'shift_types') {
            return resolve({ data: err ? null : [{ id: 's-1', is_off: false }], error: err });
          }
          if (table === 'holidays') {
            return resolve({ data: err ? null : [], error: err });
          }
          return resolve({ data: err ? null : [], error: err });
        },
      };
      return q;
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => makeImportServiceDb() }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { role: profileRole, organization_id: ORG, is_active: true },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => ({ url: 'http://db.test', key: 'anon', isConfigured: true }),
}));
vi.mock('@/lib/profile', () => ({
  getAuthProfile: async () => ({
    sb: makeLeaveDb(),
    user: authUser,
    isActive: true,
    canExportLeaveCsv: true,
  }),
  fetchAll: async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const res = await build(0, 999);
    if (res.error) return { data: [], error: res.error.message };
    return { data: res.data ?? [], error: '' };
  },
}));

const sampleBackup = {
  operators: [{ id: 'k1', name: 'Juan', role: 'Operator', phone: '', defaultStation: 'PL' }],
  shifts: { s1: { id: 's1', label: '7-4', name: 'Day', hours: 8, isOff: false } },
  areaLeaves: [{ code: 'PL', name: 'Plant Operations', isLeave: false }],
  schedule: {},
  pmTasks: [],
};

describe('/api/import route guards', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' };
    profileRole = 'admin';
    upsertCalls = [];
    leaveQueryErrors = {};
    process.env.SUPABASE_SECRET_KEY = 'secret';
    vi.stubEnv('NODE_ENV', 'test');
    delete process.env.ENABLE_LEGACY_IMPORT;
  });

  it('blocks /api/import in production unless ENABLE_LEGACY_IMPORT=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { POST } = await import('@/app/api/import/route');
    const res = await POST(
      new Request('http://app.test/api/import', {
        method: 'POST',
        body: JSON.stringify(sampleBackup),
      }),
    );
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  it('supports ?dryRun=true without writing and passes ignoreDuplicates=true by default', async () => {
    const { POST } = await import('@/app/api/import/route');

    const dryRes = await POST(
      new Request('http://app.test/api/import?dryRun=true', {
        method: 'POST',
        body: JSON.stringify(sampleBackup),
      }),
    );
    expect(dryRes.status).toBe(200);
    expect(await dryRes.json()).toMatchObject({
      dryRun: true,
      overwrite: false,
      wouldProcess: { operators: 1, shifts: 1, areas: 1 },
      existingMatches: { operators: 1, shifts: 1, areas: 1 },
    });
    expect(upsertCalls).toHaveLength(0);

    const liveSkipRes = await POST(
      new Request('http://app.test/api/import', {
        method: 'POST',
        body: JSON.stringify(sampleBackup),
      }),
    );
    expect(liveSkipRes.status).toBe(200);
    expect(upsertCalls.every((c) => c.options.ignoreDuplicates === true)).toBe(true);

    upsertCalls = [];
    const overwriteRes = await POST(
      new Request('http://app.test/api/import?overwrite=true', {
        method: 'POST',
        body: JSON.stringify(sampleBackup),
      }),
    );
    expect(overwriteRes.status).toBe(200);
    expect(upsertCalls.every((c) => c.options.ignoreDuplicates === false)).toBe(true);
  });
});

describe('/api/reports/leave-export error handling', () => {
  beforeEach(() => {
    authUser = { id: 'admin-1' };
    leaveQueryErrors = {};
  });

  it('returns 500 when holidays or schedule queries fail instead of emitting a zeroed CSV', async () => {
    const { GET } = await import('@/app/api/reports/leave-export/route');

    leaveQueryErrors = { holidays: { message: 'holidays query failed' } };
    const holFail = await GET(new NextRequest('http://app.test/api/reports/leave-export?y=2026'));
    expect(holFail.status).toBe(500);

    leaveQueryErrors = { schedule_assignments: { message: 'timeout' } };
    const asgFail = await GET(new NextRequest('http://app.test/api/reports/leave-export?y=2026'));
    expect(asgFail.status).toBe(500);

    leaveQueryErrors = {};
    const okRes = await GET(new NextRequest('http://app.test/api/reports/leave-export?y=2026'));
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toContain('"Operator","SL","Total Leave"');
  });
});
