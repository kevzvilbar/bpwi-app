import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  minHeight?: number;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  minHeight,
  className = '',
}: EmptyStateProps) {
  const classes = ['empty-state', className].filter(Boolean).join(' ');

  return (
    <div className={classes} style={minHeight ? { minHeight } : undefined}>
      <div className="empty-state-inner">
        <strong className="empty-state-title">{title}</strong>
        {description && <div className="empty-state-desc">{description}</div>}
        {action && <div className="empty-state-action">{action}</div>}
      </div>
    </div>
  );
}
