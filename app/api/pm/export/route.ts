import { NextRequest, NextResponse } from 'next/server';
import { getProfile, fetchAll } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import { csvQuote } from '@/lib/csv';

const PRESET_LABELS: Record<string, string> = {
  FLUSH: 'Line Flushing',
  TANK: 'Tank Cleaning',
  PULL: 'Well Pull-out',
  THERM: 'Thermal Scanning',
  LEVEL: 'Water Level Monitoring',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { sb, user, isAdmin, isManager } = await getProfile();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin && !isManager) {
    return NextResponse.json({ error: 'Only admins and department heads can export PM schedules' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const today = manilaToday();
  const year = today.slice(0, 4);
  const from = DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : `${year}-01-01`;
  const to = DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : `${year}-12-31`;
  if (to < from) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 });
  }

  const typeFilter = (sp.get('type') ?? '').trim();
  const statusFilter = (sp.get('status') ?? '').trim();
  const areaFilter = (sp.get('area') ?? '').trim();
  const rawLabel = (sp.get('label') ?? `${from}_to_${to}`).replace(/[^a-zA-Z0-9_-]/g, '-');

  const [tasksRes, actTypesRes, opsRes] = await Promise.all([
    fetchAll<{
      scheduled_date: string;
      activity_type: string;
      title: string;
      locations: string[] | null;
      asset: string | null;
      assigned_operator_ids: string[] | null;
      status: string;
      completed_at: string | null;
      remarks: string | null;
    }>((start, end) => {
      let q = sb
        .from('pm_tasks')
        .select('scheduled_date, activity_type, title, locations, asset, assigned_operator_ids, status, completed_at, remarks')
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .order('scheduled_date', { ascending: true })
        .range(start, end);
      if (typeFilter) q = q.eq('activity_type', typeFilter);
      if (statusFilter) q = q.eq('status', statusFilter);
      return q;
    }),
    sb.from('pm_activity_types').select('code, label'),
    sb.from('operators').select('id, full_name'),
  ]);

  if (tasksRes.error) {
    return NextResponse.json({ error: tasksRes.error }, { status: 500 });
  }

  const actLabelByCode = new Map<string, string>(Object.entries(PRESET_LABELS));
  for (const a of actTypesRes.data ?? []) {
    actLabelByCode.set(a.code, a.label);
  }
  const opById = new Map((opsRes.data ?? []).map((o) => [o.id, o.full_name]));

  const rows = areaFilter
    ? tasksRes.data.filter((t) => (t.locations ?? []).includes(areaFilter))
    : tasksRes.data;

  const headers = [
    'Scheduled Date',
    'Activity Code',
    'Activity Name',
    'Title',
    'Locations',
    'Asset',
    'Assigned Operators',
    'Status',
    'Completed At',
    'Remarks',
  ];
  const lines = [headers.map(csvQuote).join(',')];

  for (const t of rows) {
    const assigned = (t.assigned_operator_ids ?? []).map((id) => opById.get(id) ?? id).join('; ');
    lines.push(
      [
        t.scheduled_date,
        t.activity_type,
        actLabelByCode.get(t.activity_type) ?? t.activity_type,
        t.title,
        (t.locations ?? []).join('; '),
        t.asset ?? '',
        assigned,
        t.status,
        t.completed_at ?? '',
        t.remarks ?? '',
      ]
        .map(csvQuote)
        .join(','),
    );
  }

  return new NextResponse(`\uFEFF${lines.join('\r\n')}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bpwi-pm-schedule-${rawLabel}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
