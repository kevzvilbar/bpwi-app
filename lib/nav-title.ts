const ROUTE_TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: '/field', title: 'Tasks' },
  { prefix: '/mobile', title: 'Tasks' },
  { prefix: '/activities', title: 'Activities' },
  { prefix: '/pm', title: 'PM Plan' },
  { prefix: '/call-sheet', title: 'Standby' },
  { prefix: '/inventory', title: 'Inventory' },
  { prefix: '/reports', title: 'Reports' },
  { prefix: '/requests', title: 'Change Requests' },
  { prefix: '/operators', title: 'Operators & Setup' },
  { prefix: '/org-chart', title: 'Org Chart' },
  { prefix: '/generate', title: 'Generate Schedule' },
  { prefix: '/leave', title: 'Leave Summary' },
  { prefix: '/login', title: 'Sign in' },
];

export function getDocumentTitle(pathname: string, orgName: string, appTitle: string): string {
  const cleanOrg = orgName.trim() || 'BP Waterworks, Inc.';
  const cleanApp = appTitle.trim() || 'Operations & Plant Schedule';
  const match = ROUTE_TITLES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return match ? `${match.title} · ${cleanOrg}` : `${cleanOrg} · ${cleanApp}`;
}
