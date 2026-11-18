import { getProfile } from '@/lib/profile';
import { manilaToday } from '@/lib/date';
import Generator from '@/components/Generator';

export const dynamic = 'force-dynamic';

export default async function GeneratePage() {
  const { sb, orgId, canGenerate } = await getProfile();
  const today = manilaToday();
  const [ops, shifts, areas] = await Promise.all([
    sb.from('operators').select('id, full_name').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, is_off, background_color, text_color').order('code'),
    sb.from('area_codes').select('id, code, category').order('code'),
  ]);
  return (
    <Generator
      today={today}
      operators={ops.data ?? []}
      shifts={shifts.data ?? []}
      areas={areas.data ?? []}
      orgId={orgId}
      canEdit={canGenerate}
    />
  );
}
