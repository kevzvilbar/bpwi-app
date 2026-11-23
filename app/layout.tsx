import type { Viewport } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import PwaRegister from '@/components/PwaRegister';
import DialogA11y from '@/components/DialogA11y';
import PendingApproval from '@/components/PendingApproval';
import EditAccessBanner from '@/components/EditAccessBanner';
import OfflineSyncBanner from '@/components/OfflineSyncBanner';
import { getProfile, type EditGrant } from '@/lib/profile';
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
    icon: [
      { url: '/bpwi-logo.svg', type: 'image/svg+xml' },
      { url: '/bpwi-logo.png', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#080d18' },
  ],
};

const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('bpwi-theme');var d=t?t==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var hc=localStorage.getItem('bpwi-hc')==='1';document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.contrast=hc?'high':'normal';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let profile = {
    hasUser: false,
    userId: '',
    userEmail: '',
    isActive: true,
    pendingUsersCount: 0,
    pendingRequestsCount: 0,
    pendingReportsCount: 0,
    role: 'viewer',
    name: '',
    orgId: '',
    orgName: 'BP Waterworks, Inc.',
    appTitle: 'Operations & Plant Schedule',
    canEdit: false,
    canGenerate: false,
    canApprove: false,
    isAdmin: false,
    isManager: false,
    editGrant: null as EditGrant | null,
    nextGrant: null as EditGrant | null,
  };
  if (getSupabaseEnv().isConfigured) {
    try {
      const p = await getProfile();
      profile = {
        hasUser: Boolean(p.user),
        userId: p.user?.id ?? '',
        userEmail: p.user?.email ?? '',
        isActive: p.isActive,
        pendingUsersCount: p.pendingUsersCount,
        pendingRequestsCount: p.pendingRequestsCount,
        pendingReportsCount: p.pendingReportsCount,
        role: p.role,
        name: p.name,
        orgId: p.orgId,
        orgName: p.orgName,
        appTitle: p.appTitle,
        canEdit: p.canEdit,
        canGenerate: p.canGenerate,
        canApprove: p.canApprove,
        isAdmin: p.isAdmin,
        isManager: p.isManager,
        editGrant: p.editGrant,
        nextGrant: p.nextGrant,
      };
    } catch {
      /* static prerender or unauthenticated */
    }
  }
  const pendingApproval = profile.hasUser && !profile.isActive;
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <PwaRegister />
        <DialogA11y />
        {!pendingApproval && (
          <Nav
            role={profile.role}
            userId={profile.userId}
            userName={profile.name}
            orgId={profile.orgId}
            orgName={profile.orgName}
            appTitle={profile.appTitle}
            canEdit={profile.canEdit}
            canGenerate={profile.canGenerate}
            canApprove={profile.canApprove}
            isAdmin={profile.isAdmin}
            pendingUsersCount={profile.pendingUsersCount}
            pendingRequestsCount={profile.pendingRequestsCount}
            pendingReportsCount={profile.pendingReportsCount}
            hasUser={profile.hasUser}
          />
        )}
        {profile.hasUser && !pendingApproval && <OfflineSyncBanner userId={profile.userId} />}
        {profile.isManager && !pendingApproval && <EditAccessBanner active={profile.editGrant} next={profile.nextGrant} />}
        <main className="app-main">
          <PendingApproval pending={pendingApproval} userName={profile.name} userEmail={profile.userEmail}>
            {children}
          </PendingApproval>
        </main>
      </body>
    </html>
  );
}
