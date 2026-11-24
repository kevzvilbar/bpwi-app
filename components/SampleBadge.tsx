'use client';

import { formatSampleRemaining } from '@/lib/sample-logs';

export function SampleBadge({ expiresAt }: { expiresAt?: string | null }) {
  return (
    <span
      title="Sample log — excluded from KPIs/reports and automatically deleted after 24 hours"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: 'var(--warn-bg)',
        color: 'var(--warn-fg)',
        border: '1px solid var(--warn-border)',
      }}
    >
      SAMPLE · {formatSampleRemaining(expiresAt)}
    </span>
  );
}

export function SamplePrintWatermark() {
  return (
    <div className="sample-print-watermark" aria-hidden="true">
      SAMPLE — AUTO-DELETES IN 24H
    </div>
  );
}
