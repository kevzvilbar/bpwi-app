import { getProfile } from '@/lib/profile';
import Setup from '@/components/Setup';

export const dynamic = 'force-dynamic';

export default async function OperatorsPage() {
  const { sb, orgId, isAdmin } = await getProfile();
  const [ops, shifts, areas] = await Promise.all([
    sb.from('operators').select('id, full_name, position, phone_number, default_station, sort_order, is_active').order('sort_order'),
    sb.from('shift_types').select('id, code, description, duration_hours, is_off, background_color, text_color').order('code'),
    sb.from('area_codes').select('id, code, name, category, background_color, text_color').order('code'),
  ]);
  return <Setup operators={ops.data ?? []} shifts={shifts.data ?? []} areas={areas.data ?? []} orgId={orgId} isAdmin={isAdmin}
    error={ops.error?.message ?? shifts.error?.message ?? areas.error?.message ?? ''} />;
}
