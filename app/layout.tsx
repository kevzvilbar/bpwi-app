import type { Viewport } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import PwaRegister from '@/components/PwaRegister';
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
    icon: '/bpwi-logo.png',
    apple: '/bpwi-logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let profile = {
    role: 'viewer',
    name: '',
    orgId: '',
    orgName: 'BP Waterworks, Inc.',
    appTitle: 'Operations & Plant Schedule',
    canEdit: false,
    isAdmin: false,
  };
  if (getSupabaseEnv().isConfigured) {
    try {
      const p = await getProfile();
      profile = {
        role: p.role,
        name: p.name,
        orgId: p.orgId,
        orgName: p.orgName,
        appTitle: p.appTitle,
        canEdit: p.canEdit,
        isAdmin: p.isAdmin,
      };
    } catch {
      /* static prerender or unauthenticated */
    }
  }
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <Nav
          role={profile.role}
          userName={profile.name}
          orgId={profile.orgId}
          orgName={profile.orgName}
          appTitle={profile.appTitle}
          canEdit={profile.canEdit}
          isAdmin={profile.isAdmin}
        />
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
