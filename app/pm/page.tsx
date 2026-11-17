import { getProfile } from '@/lib/profile';
import PmPlanner from '@/components/PmPlanner';

export const dynamic = 'force-dynamic';

export default async function PmPage({ searchParams }: { searchParams: { m?: string } }) {
  const { sb, orgId, canEdit } = await getProfile();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? '') ? searchParams.m! : today.slice(0, 7);
  const [y, mo] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  const [tasks, ops] = await Promise.all([
    sb.from('pm_tasks').select('*').gte('scheduled_date', first).lte('scheduled_date', last).order('scheduled_date'),
    sb.from('operators').select('id, full_name').eq('is_active', true).order('sort_order'),
  ]);
  return (
    <PmPlanner
      key={month}
      month={month}
      today={today}
      tasks={tasks.data ?? []}
      operators={ops.data ?? []}
      orgId={orgId}
      canEdit={canEdit}
      error={tasks.error?.message ?? ''}
    />
  );
}
