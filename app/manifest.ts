import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'BP Waterworks · Plant Operations',
    short_name: 'BPWI Ops',
    description: 'Plant operations schedule, standby call sheet, attendance, and PM task tracker.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f1f5f9',
    theme_color: '#0f172a',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Tasks & Logs',
        short_name: 'Tasks',
        url: '/field',
        icons: [{ src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Daily Activities',
        short_name: 'Activities',
        url: '/activities',
        icons: [{ src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'PM Plan',
        short_name: 'PM Plan',
        url: '/pm',
        icons: [{ src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
