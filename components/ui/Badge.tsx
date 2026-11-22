import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'violet';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  size = 'md',
  title,
  className = '',
  children,
}: BadgeProps) {
  const classes = ['badge', `badge-${tone}`, size === 'sm' ? 'badge-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
