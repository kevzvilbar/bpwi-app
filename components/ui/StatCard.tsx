import type { ReactNode } from 'react';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  subtitleTone?: 'default' | 'warn' | 'ok' | 'danger';
  className?: string;
}

export function StatCard({
  label,
  value,
  subtitle,
  subtitleTone = 'default',
  className = '',
}: StatCardProps) {
  const classes = ['card', 'stat-card', className].filter(Boolean).join(' ');
  const subClasses = [
    'stat-sub',
    subtitleTone !== 'default' ? `stat-sub-${subtitleTone}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value tabular-nums">{value}</strong>
      {subtitle !== undefined && subtitle !== null && (
        <span className={subClasses}>{subtitle}</span>
      )}
    </div>
  );
}
