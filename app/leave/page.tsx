import { getProfile, fetchAll } from '@/lib/profile';
import LeaveSummary from '@/components/LeaveSummary';

export const dynamic = 'force-dynamic';

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const sp = await searchParams;
  const { sb } = await getProfile();
  const thisYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : thisYear;
  const [ops, areas] = await Promise.all([
    sb.from('operators').select('id, full_name, position').eq('is_active', true).order('sort_order'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').in('category', ['leave', 'holiday']).order('code'),
  ]);
  const ids = (areas.data ?? []).map((a) => a.id);
  const asg = ids.length
    ? await fetchAll<{ operator_id: string; schedule_date: string; area_code_id: string }>((from, to) =>
        sb.from('schedule_assignments').select('operator_id, schedule_date, area_code_id').in('area_code_id', ids)
          .gte('schedule_date', `${year}-01-01`).lte('schedule_date', `${year}-12-31`).order('schedule_date').range(from, to))
    : { data: [], error: '' };
  return <LeaveSummary year={year} operators={ops.data ?? []} areas={areas.data ?? []} rows={asg.data} error={asg.error || ops.error?.message || areas.error?.message || ''} />;
}
