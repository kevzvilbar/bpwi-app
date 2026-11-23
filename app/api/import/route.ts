// POST the JSON backup from the standalone HTML app. Admin only. Idempotent (safe to re-run).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getErrorMessage } from '@/lib/error-utils';
import { normalizeLegacyStationCode } from '@/lib/roster-helpers';

interface LegacyOperator {
  id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  defaultStation?: string | null;
}

interface LegacyShift {
  id: string;
  label: string;
  name?: string | null;
  hours?: number | null;
  isOff?: boolean;
  bg?: string | null;
  text?: string | null;
}

interface LegacyArea {
  code: string;
  name?: string | null;
  isLeave?: boolean;
  bg?: string | null;
  text?: string | null;
}

interface LegacyScheduleCell {
  shift?: string;
  text?: string | null;
  onCall?: string | null;
}

interface LegacyPmCustomType {
  id?: string;
  label?: string;
  short?: string;
  color?: string;
}

interface LegacyPmTypeOverride {
  label?: string;
  short?: string;
  color?: string;
}

interface LegacyPmTask {
  id: string;
  type: string;
  sites?: string[];
  site?: string | null;
  asset?: string | null;
  assignees?: string[];
  date: string;
  status?: string;
  doneOn?: string | null;
  notes?: string | null;
}

interface LegacyImportPayload {
  operators?: LegacyOperator[];
  shifts?: Record<string, LegacyShift>;
  areaLeaves?: LegacyArea[];
  schedule?: Record<string, Record<string, LegacyScheduleCell>>;
  pmTypeOverrides?: Record<string, LegacyPmTypeOverride>;
  pmCustomTypes?: LegacyPmCustomType[];
  pmTasks?: LegacyPmTask[];
}

interface KeyedIdRow {
  id: string;
  legacy_key: string;
}

interface AssignmentInsertRow {
  organization_id: string;
  operator_id: string;
  schedule_date: string;
  shift_type_id: string | null;
  area_code_id: string | null;
}

interface StandbyInsertRow {
  organization_id: string;
  operator_id: string;
  schedule_date: string;
  standby_type: string;
}

interface ActivityTypeInsertRow {
  organization_id: string;
  code: string;
  label: string;
  short_label: string;
  color: string;
  sort_order: number;
}

const DEFAULT_PM_META: Record<string, { label: string; short: string; color: string }> = {
  FLUSH: { label: 'Line Flushing', short: 'Flushing', color: '#0284c7' },
  TANK: { label: 'Tank Cleaning', short: 'Tank Cleaning', color: '#0d9488' },
  PULL: { label: 'Deep Well Pump & Motor Pull-out', short: 'Pull-out', color: '#db2777' },
  THERM: { label: 'Thermal Scanning', short: 'Thermal Scan', color: '#ea580c' },
  LEVEL: { label: 'Water Level Monitoring', short: 'SWL&PWL', color: '#ca8a04' },
};

export async function POST(req: Request) {
  try {
    const me = await supabaseServer();
    const {
      data: { user },
    } = await me.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: prof } = await me
      .from('user_profiles')
      .select('role, organization_id, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (!prof || prof.is_active === false || prof.role !== 'admin') {
      return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    }

    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!url || !secretKey) {
      return NextResponse.json({ error: 'Server secret key (SUPABASE_SECRET_KEY) is not configured' }, { status: 503 });
    }

    const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: 'Import payload exceeds 10 MB limit' }, { status: 413 });
    }
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: 'Import payload exceeds 10 MB limit' }, { status: 413 });
    }
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    const st = rawBody as LegacyImportPayload;

    const org = prof.organization_id as string;
    const db = createClient(url, secretKey, { auth: { persistSession: false } });
    const must = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as T;
    };

    const ops = await must<KeyedIdRow[]>(
      db
        .from('operators')
        .upsert(
          (st.operators ?? []).map((o, i) => ({
            organization_id: org,
            legacy_key: o.id,
            full_name: o.name,
            position: o.role,
            phone_number: o.phone,
            default_station: o.defaultStation ? normalizeLegacyStationCode(o.defaultStation) : o.defaultStation,
            sort_order: i,
          })),
          { onConflict: 'organization_id,legacy_key' },
        )
        .select('id, legacy_key'),
    );
    const shifts = await must<KeyedIdRow[]>(
      db
        .from('shift_types')
        .upsert(
          Object.values(st.shifts ?? {}).map((s) => ({
            organization_id: org,
            legacy_key: s.id,
            code: s.label,
            description: s.name,
            duration_hours: s.hours ?? 0,
            is_off: !!s.isOff,
            background_color: s.bg,
            text_color: s.text,
          })),
          { onConflict: 'organization_id,legacy_key' },
        )
        .select('id, legacy_key'),
    );
    const mapAreaCategory = (a: LegacyArea, allowRest: boolean) => {
      const code = String(a.code ?? '').trim().toUpperCase();
      if (code === 'RD' || /rest\s*day/i.test(a.name ?? '')) return allowRest ? 'rest' : 'leave';
      if (/holiday/i.test(a.name ?? '') || code === 'H') return 'holiday';
      return a.isLeave ? 'leave' : 'station';
    };
    const CANONICAL_STATION_NAMES: Record<string, string> = {
      PL: 'Plant Operations',
      FD: 'Field Operations',
      WD: 'Water Delivery',
    };
    const areaPayload = (allowRest: boolean) => {
      const deduped = new Map<
        string,
        {
          organization_id: string;
          code: string;
          name: string | null | undefined;
          category: string;
          background_color: string | null | undefined;
          text_color: string | null | undefined;
        }
      >();
      for (const a of st.areaLeaves ?? []) {
        const code = normalizeLegacyStationCode(a.code ?? '');
        if (!code) continue;
        const key = code.toUpperCase();
        const cat = mapAreaCategory({ ...a, code }, allowRest);
        deduped.set(key, {
          organization_id: org,
          code,
          name: CANONICAL_STATION_NAMES[key] ?? a.name,
          category: cat,
          background_color: a.bg,
          text_color: a.text,
        });
      }
      return Array.from(deduped.values());
    };
    let areaRes = await db.from('area_codes').upsert(areaPayload(true), { onConflict: 'organization_id,code' }).select('id, code');
    if (areaRes.error && /area_codes_category_check/i.test(areaRes.error.message)) {
      areaRes = await db.from('area_codes').upsert(areaPayload(false), { onConflict: 'organization_id,code' }).select('id, code');
    }
    if (areaRes.error) throw new Error(areaRes.error.message);
    const areas = (areaRes.data ?? []) as Array<{ id: string; code: string }>;
    const opId = new Map(ops.map((o) => [o.legacy_key, o.id]));
    const shiftId = new Map(shifts.map((s) => [s.legacy_key, s.id]));
    const areaId = new Map(areas.map((a) => [a.code, a.id]));

    const asg: AssignmentInsertRow[] = [];
    const standby: StandbyInsertRow[] = [];
    for (const [legacy, days] of Object.entries(st.schedule ?? {})) {
      const operator_id = opId.get(legacy);
      if (!operator_id) continue;
      for (const [date, c] of Object.entries(days ?? {})) {
        if (!c || (c.shift === 'white' && !c.text && !c.onCall)) continue;
        asg.push({
          organization_id: org,
          operator_id,
          schedule_date: date,
          shift_type_id: c.shift ? shiftId.get(c.shift) ?? null : null,
          area_code_id: c.text ? areaId.get(normalizeLegacyStationCode(c.text)) ?? null : null,
        });
        if (c.onCall) standby.push({ organization_id: org, operator_id, schedule_date: date, standby_type: c.onCall });
      }
    }
    for (let i = 0; i < asg.length; i += 500) {
      await must(db.from('schedule_assignments').upsert(asg.slice(i, i + 500), { onConflict: 'operator_id,schedule_date' }));
    }
    for (let i = 0; i < standby.length; i += 500) {
      await must(db.from('standby_assignments').upsert(standby.slice(i, i + 500), { onConflict: 'operator_id,schedule_date' }));
    }

    const typeLabel = (k: string) =>
      st.pmTypeOverrides?.[k]?.label ?? st.pmCustomTypes?.find((c) => c.id === k)?.label ?? DEFAULT_PM_META[k]?.label ?? k;

    const activityRows: ActivityTypeInsertRow[] = [];
    const seenCodes = new Set<string>();
    let sortIdx = 0;
    for (const [code, meta] of Object.entries(DEFAULT_PM_META)) {
      const ov = st.pmTypeOverrides?.[code];
      seenCodes.add(code);
      activityRows.push({
        organization_id: org,
        code,
        label: ov?.label ?? meta.label,
        short_label: ov?.short ?? ov?.label ?? meta.short,
        color: ov?.color ?? meta.color,
        sort_order: sortIdx++,
      });
    }
    for (const c of st.pmCustomTypes ?? []) {
      if (!c?.id || seenCodes.has(c.id)) continue;
      seenCodes.add(c.id);
      const ov = st.pmTypeOverrides?.[c.id];
      activityRows.push({
        organization_id: org,
        code: c.id,
        label: ov?.label ?? c.label ?? c.id,
        short_label: ov?.short ?? c.short ?? c.label ?? c.id,
        color: ov?.color ?? c.color ?? '#7c3aed',
        sort_order: sortIdx++,
      });
    }
    if (activityRows.length > 0) {
      await must(db.from('pm_activity_types').upsert(activityRows, { onConflict: 'organization_id,code' }));
    }

    const pm = (st.pmTasks ?? []).map((t) => ({
      organization_id: org,
      legacy_key: t.id,
      activity_type: t.type,
      title: typeLabel(t.type),
      locations: t.sites ?? (t.site ? [t.site] : []),
      asset: t.asset ?? null,
      assigned_operator_ids: (t.assignees ?? []).map((a) => opId.get(a)).filter((id): id is string => Boolean(id)),
      scheduled_date: t.date,
      status: t.status ?? 'planned',
      completed_at: t.doneOn ?? null,
      remarks: t.notes ?? null,
    }));
    for (let i = 0; i < pm.length; i += 500) {
      await must(db.from('pm_tasks').upsert(pm.slice(i, i + 500), { onConflict: 'organization_id,legacy_key' }));
    }
    return NextResponse.json({
      operators: ops.length,
      shifts: shifts.length,
      areas: areas.length,
      assignments: asg.length,
      standby: standby.length,
      pm_tasks: pm.length,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e, 'Import failed') }, { status: 500 });
  }
}
