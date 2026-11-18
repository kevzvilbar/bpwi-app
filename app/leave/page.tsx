import { getProfile, fetchAll } from '@/lib/profile';
import { manilaYear } from '@/lib/date';
import LeaveSummary from '@/components/LeaveSummary';

export const dynamic = 'force-dynamic';

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const sp = await searchParams;
  const { sb } = await getProfile();
  const thisYear = manilaYear();
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : thisYear;
  const [ops, areas, shifts, holRes] = await Promise.all([
    sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').in('category', ['leave', 'holiday', 'rest']).order('code'),
    sb.from('shift_types').select('id, is_off'),
    sb.from('holidays').select('holiday_date, name, holiday_type').gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`).order('holiday_date'),
  ]);
  const ids = (areas.data ?? []).map((a) => a.id);
  const nonWorkingAreaSet = new Set(ids);
  const offShiftSet = new Set((shifts.data ?? []).filter((s) => s.is_off).map((s) => s.id));
  const holidays = holRes.error ? [] : (holRes.data ?? []);
  const holidayDates = holidays.map((h) => h.holiday_date);

  const [asg, holAsg] = await Promise.all([
    ids.length
      ? fetchAll<{ operator_id: string; schedule_date: string; area_code_id: string }>((from, to) =>
          sb.from('schedule_assignments').select('operator_id, schedule_date, area_code_id').in('area_code_id', ids)
            .gte('schedule_date', `${year}-01-01`).lte('schedule_date', `${year}-12-31`).order('schedule_date').range(from, to))
      : Promise.resolve({ data: [], error: '' }),
    holidayDates.length
      ? fetchAll<{ operator_id: string; schedule_date: string; shift_type_id: string | null; area_code_id: string | null }>((from, to) =>
          sb.from('schedule_assignments').select('operator_id, schedule_date, shift_type_id, area_code_id')
            .in('schedule_date', holidayDates).order('schedule_date').range(from, to))
      : Promise.resolve({ data: [], error: '' }),
  ]);

  const holidayWorked = holAsg.data.filter(
    (r) => r.shift_type_id && !offShiftSet.has(r.shift_type_id) && !(r.area_code_id && nonWorkingAreaSet.has(r.area_code_id)),
  );

  return (
    <LeaveSummary
      year={year}
      operators={ops.data ?? []}
      areas={areas.data ?? []}
      rows={asg.data}
      holidays={holidays}
      holidayWorked={holidayWorked}
      error={asg.error || ops.error?.message || areas.error?.message || ''}
    />
  );
}
