// POST the JSON backup from the standalone HTML app. Admin only. Idempotent (safe to re-run).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/supabase/env';

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
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (prof?.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

    const { url } = getSupabaseEnv();
    const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!url || !secretKey) {
      return NextResponse.json({ error: 'Server secret key (SUPABASE_SECRET_KEY) is not configured' }, { status: 503 });
    }

    const st = await req.json();
    if (!st || typeof st !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const org = prof.organization_id as string;
    const db = createClient(url, secretKey, { auth: { persistSession: false } });
    const must = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as T;
    };

    const ops = await must(
      db
        .from('operators')
        .upsert(
          (st.operators ?? []).map((o: any, i: number) => ({
            organization_id: org,
            legacy_key: o.id,
            full_name: o.name,
            position: o.role,
            phone_number: o.phone,
            default_station: o.defaultStation,
            sort_order: i,
          })),
          { onConflict: 'organization_id,legacy_key' },
        )
        .select('id, legacy_key'),
    );
    const shifts = await must(
      db
        .from('shift_types')
        .upsert(
          Object.values(st.shifts ?? {}).map((s: any) => ({
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
    const areas = await must(
      db
        .from('area_codes')
        .upsert(
          (st.areaLeaves ?? []).map((a: any) => ({
            organization_id: org,
            code: a.code,
            name: a.name,
            category: a.isLeave ? 'leave' : /holiday/i.test(a.name ?? '') || a.code === 'H' ? 'holiday' : 'station',
            background_color: a.bg,
            text_color: a.text,
          })),
          { onConflict: 'organization_id,code' },
        )
        .select('id, code'),
    );
    const opId = new Map(ops.map((o: any) => [o.legacy_key, o.id]));
    const shiftId = new Map(shifts.map((s: any) => [s.legacy_key, s.id]));
    const areaId = new Map(areas.map((a: any) => [a.code, a.id]));

    const asg: any[] = [];
    const standby: any[] = [];
    for (const [legacy, days] of Object.entries<any>(st.schedule ?? {})) {
      const operator_id = opId.get(legacy);
      if (!operator_id) continue;
      for (const [date, c] of Object.entries<any>(days)) {
        if (!c || (c.shift === 'white' && !c.text && !c.onCall)) continue;
        asg.push({
          organization_id: org,
          operator_id,
          schedule_date: date,
          shift_type_id: shiftId.get(c.shift) ?? null,
          area_code_id: c.text ? areaId.get(c.text) ?? null : null,
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
      st.pmTypeOverrides?.[k]?.label ?? st.pmCustomTypes?.find((c: any) => c.id === k)?.label ?? DEFAULT_PM_META[k]?.label ?? k;

    const activityRows: any[] = [];
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
      await db.from('pm_activity_types').upsert(activityRows, { onConflict: 'organization_id,code' });
    }

    const pm = (st.pmTasks ?? []).map((t: any) => ({
      organization_id: org,
      legacy_key: t.id,
      activity_type: t.type,
      title: typeLabel(t.type),
      locations: t.sites ?? (t.site ? [t.site] : []),
      asset: t.asset ?? null,
      assigned_operator_ids: (t.assignees ?? []).map((a: string) => opId.get(a)).filter(Boolean),
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Import failed' }, { status: 500 });
  }
}
