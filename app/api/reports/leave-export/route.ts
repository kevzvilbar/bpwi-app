import { NextRequest, NextResponse } from 'next/server';
import { getAuthProfile, fetchAll } from '@/lib/profile';
import { manilaYear } from '@/lib/date';
import { csvQuote } from '@/lib/csv';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function GET(req: NextRequest) {
  const { sb, user, isActive, canExportLeaveCsv } = await getAuthProfile();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isActive || !canExportLeaveCsv) {
    return NextResponse.json(
      { error: 'Only admins, schedulers, and department heads can export leave summaries' },
      { status: 403 },
    );
  }

  const yParam = req.nextUrl.searchParams.get('y') ?? '';
  const year = /^\d{4}$/.test(yParam) ? Number(yParam) : manilaYear();

  const [ops, areas, shifts, holRes] = await Promise.all([
    sb.from('operators').select('id, full_name').eq('is_active', true).order('sort_order'),
    sb.from('area_codes').select('id, code, category').in('category', ['leave', 'holiday', 'rest']).order('code'),
    sb.from('shift_types').select('id, is_off'),
    sb.from('holidays').select('holiday_date, holiday_type').gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`),
  ]);

  const leaveAreas = (areas.data ?? []).filter((a) => a.category === 'leave');
  const nonWorkingIds = new Set((areas.data ?? []).map((a) => a.id));
  const leaveIds = leaveAreas.map((a) => a.id);
  const offShiftIds = new Set((shifts.data ?? []).filter((s) => s.is_off).map((s) => s.id));
  const holidays = holRes.error ? [] : (holRes.data ?? []);
  const holidayDates = holidays.map((h) => h.holiday_date);

  const [asg, holAsg] = await Promise.all([
    leaveIds.length
      ? fetchAll<{ operator_id: string; schedule_date: string; area_code_id: string | null }>((from, to) =>
          sb.from('schedule_assignments').select('operator_id, schedule_date, area_code_id').in('area_code_id', leaveIds)
            .gte('schedule_date', `${year}-01-01`).lte('schedule_date', `${year}-12-31`).order('schedule_date').range(from, to))
      : Promise.resolve({ data: [], error: '' }),
    holidayDates.length
      ? fetchAll<{ operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null }>((from, to) =>
          sb.from('schedule_assignments').select('operator_id, schedule_date, shift_type_id, area_code_id')
            .in('schedule_date', holidayDates).order('schedule_date').range(from, to))
      : Promise.resolve({ data: [], error: '' }),
  ]);

  const holTypeByDate = new Map(holidays.map((h) => [h.holiday_date, h.holiday_type]));
  const holWorkedCounts = new Map<string, { reg: number; spec: number }>();
  for (const r of holAsg.data) {
    if (!r.shift_type_id || offShiftIds.has(r.shift_type_id)) continue;
    if (r.area_code_id && nonWorkingIds.has(r.area_code_id)) continue;
    const hType = holTypeByDate.get(r.schedule_date);
    if (!hType) continue;
    const cur = holWorkedCounts.get(r.operator_id) ?? { reg: 0, spec: 0 };
    if (hType === 'regular') cur.reg += 1;
    else cur.spec += 1;
    holWorkedCounts.set(r.operator_id, cur);
  }

  const byCode = new Map<string, number>();
  const byMonth = new Map<string, number>();
  for (const r of asg.data) {
    byCode.set(`${r.operator_id}:${r.area_code_id}`, (byCode.get(`${r.operator_id}:${r.area_code_id}`) ?? 0) + 1);
    const mIdx = Number(r.schedule_date.slice(5, 7)) - 1;
    byMonth.set(`${r.operator_id}:${mIdx}`, (byMonth.get(`${r.operator_id}:${mIdx}`) ?? 0) + 1);
  }

  const head = ['Operator', ...leaveAreas.map((a) => a.code), 'Total Leave', ...MONTHS, 'Reg Hol Worked', 'Spec Hol Worked'];
  const lines = [head.map(csvQuote).join(',')];

  for (const op of ops.data ?? []) {
    const codeCounts = leaveAreas.map((a) => byCode.get(`${op.id}:${a.id}`) ?? 0);
    const total = codeCounts.reduce((s, n) => s + n, 0);
    const monthCounts = MONTHS.map((_, idx) => byMonth.get(`${op.id}:${idx}`) ?? 0);
    const hw = holWorkedCounts.get(op.id) ?? { reg: 0, spec: 0 };
    lines.push([op.full_name, ...codeCounts, total, ...monthCounts, hw.reg, hw.spec].map(csvQuote).join(','));
  }

  return new NextResponse(`\uFEFF${lines.join('\r\n')}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bpwi-leave-holiday-summary-${year}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
