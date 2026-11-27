import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Legacy `/mobile` route redirects to the offline-first `/field` shell. */
export default async function MobilePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const target = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? `/field?d=${sp.d}` : '/field';
  redirect(target);
}
