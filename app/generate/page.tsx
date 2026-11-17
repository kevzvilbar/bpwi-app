import { getProfile } from '@/lib/profile';
import Generator from '@/components/Generator';

export const dynamic = 'force-dynamic';

export default async function GeneratePage() {
  const { sb, orgId, canEdit } = await getProfile();
  const [ops, shifts] = await Promise.all([
    sb.from('operators').select('id, full_name').eq('is_active', true).order('sort_order'),
    sb.from('shift_types').select('id, code, description, is_off, background_color, text_color').order('code'),
  ]);
  return <Generator operators={ops.data ?? []} shifts={shifts.data ?? []} orgId={orgId} canEdit={canEdit} />;
}
