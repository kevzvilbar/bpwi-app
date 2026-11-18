import type { Viewport } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import PwaRegister from '@/components/PwaRegister';
import DialogA11y from '@/components/DialogA11y';
import { getProfile } from '@/lib/profile';
import { getSupabaseEnv } from '@/lib/supabase/env';

export const metadata = {
  title: 'BP Waterworks · Plant Operations Schedule',
  description: 'Plant operations roster and schedule monitoring for BP Waterworks, Inc.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'BPWI Ops',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
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
        <PwaRegister />
        <DialogA11y />
        <Nav role={profile.role} userName={profile.name} canEdit={profile.canEdit} isAdmin={profile.isAdmin} />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
