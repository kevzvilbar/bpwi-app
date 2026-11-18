import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import Generator from '@/components/Generator';

export const dynamic = 'force-dynamic';

export default async function GeneratePage() {
  const { sb, orgId, canGenerate } = await getProfile();
  const today = manilaToday();
  const [ops, shifts, areas, holidaysRes] = await Promise.all([
    sb.from('operators').select('id, full_name').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, is_off, background_color, text_color').order('code'),
    sb.from('area_codes').select('id, code, category').order('code'),
    sb.from('holidays').select('holiday_date, name, holiday_type').order('holiday_date'),
  ]);
  return (
    <Generator
      today={today}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      holidays={holidaysRes.error ? [] : (holidaysRes.data ?? [])}
      orgId={orgId}
      canEdit={canGenerate}
    />
  );
}
