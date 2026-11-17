import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BP Waterworks · Plant Operations',
    short_name: 'BPWI Ops',
    description: 'Plant operations schedule, standby call sheet, and PM task tracker.',
    start_url: '/mobile',
    display: 'standalone',
    background_color: '#f1f5f9',
    theme_color: '#0f172a',
  };
}
