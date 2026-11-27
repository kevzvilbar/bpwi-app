import type { CSSProperties } from 'react';
import type { OrgColorTheme } from '@/lib/org-chart';
import type { OrgChartMeta } from '@/components/OrgChartModals';

export const DEFAULT_META: OrgChartMeta = {
  title: 'BP Waterworks Inc. — Iloilo Field Office',
  subtitle: 'Master Organizational Chart & Shift Schedule',
  legend1: 'Regular Duty: 7:00 AM – 4:00 PM',
  legend2: 'Night Shift: 10:00 PM – 7:00 AM',
};

export const THEME_STYLES: Record<OrgColorTheme, { bg: string; fg: string; border: string; badgeBg: string; badgeFg: string }> = {
  navy: { bg: '#0f2744', fg: '#ffffff', border: '#0f2744', badgeBg: '#1e3a5f', badgeFg: '#e2e8f0' },
  blue: { bg: '#0284c7', fg: '#ffffff', border: '#0369a1', badgeBg: 'var(--info-bg)', badgeFg: 'var(--info-fg)' },
  teal: { bg: '#0f766e', fg: '#ffffff', border: '#115e59', badgeBg: 'var(--ok-bg)', badgeFg: 'var(--ok-fg)' },
  purple: { bg: '#5b21b6', fg: '#ffffff', border: '#4c1d95', badgeBg: 'var(--violet-bg)', badgeFg: 'var(--violet-fg)' },
  amber: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', border: 'var(--warn-border)', badgeBg: 'var(--warn-bg)', badgeFg: 'var(--warn-fg)' },
  slate: { bg: 'var(--surface)', fg: 'var(--text)', border: 'var(--border)', badgeBg: 'var(--info-bg)', badgeFg: 'var(--info-fg)' },
};

export const ORG_S = {
  canvas: {
    background: 'var(--surface-muted)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px 18px 20px',
    display: 'grid',
    gap: 0,
  },
  execGrid: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', gap: 0 },
  execCenter: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  supportBox: { border: '1.5px dashed var(--border)', borderRadius: 8, background: 'var(--surface)' },
  teamBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 },
  emptyTeamBox: { background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 8 },
  orphanBox: { border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--surface)', marginTop: 12 },
  stemWrap: { display: 'flex', justifyContent: 'center' },
  stemLine: { width: 2, height: '100%', background: 'var(--border)' },
  logoImg: { width: 48, height: 36, objectFit: 'contain' },
} satisfies Record<string, CSSProperties>;

export function StemDown({ height = 14 }: { height?: number }) {
  return (
    <div style={{ ...ORG_S.stemWrap, height }}>
      <div style={ORG_S.stemLine} />
    </div>
  );
}

export function BusConnector({
  items,
  gridTemplateColumns,
  height,
}: {
  items: Array<{ key: string; span?: number }>;
  gridTemplateColumns: string;
  height: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns, columnGap: 12 }}>
      {items.map((item, idx) => (
        <div
          key={item.key}
          style={{ gridColumn: item.span ? `span ${item.span}` : undefined, position: 'relative', height }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: idx === 0 ? '50%' : -6,
              right: idx === items.length - 1 ? '50%' : -6,
              height: 2,
              background: 'var(--border)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: 2,
              height,
              background: 'var(--border)',
              transform: 'translateX(-50%)',
            }}
          />
        </div>
      ))}
    </div>
  );
}
