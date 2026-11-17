import './globals.css';
import Nav from '@/components/Nav';
import { getProfile } from '@/lib/profile';
import { getSupabaseEnv } from '@/lib/supabase/env';

export const metadata = {
  title: 'BP Waterworks · Plant Operations Schedule',
  description: 'Plant operations roster and schedule monitoring for BP Waterworks, Inc.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let profile = { role: 'viewer', name: '', canEdit: false, isAdmin: false };
  if (getSupabaseEnv().isConfigured) {
    try {
      const p = await getProfile();
      profile = { role: p.role, name: p.name, canEdit: p.canEdit, isAdmin: p.isAdmin };
    } catch {
      /* static prerender or unauthenticated */
    }
  }
  return (
    <html lang="en">
      <body>
        <Nav role={profile.role} userName={profile.name} canEdit={profile.canEdit} isAdmin={profile.isAdmin} />
        {children}
      </body>
    </html>
  );
}
