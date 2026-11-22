'use client';

import type { ReactNode } from 'react';

export type AlertTone = 'ok' | 'warn' | 'danger' | 'info';

export interface AlertBannerProps {
  tone: AlertTone;
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function AlertBanner({
  tone,
  onDismiss,
  action,
  className = '',
  children,
}: AlertBannerProps) {
  const role = tone === 'danger' || tone === 'warn' ? 'alert' : 'status';
  const classes = ['alert', `alert-${tone}`, className].filter(Boolean).join(' ');

  return (
    <div role={role} className={classes}>
      <div className="alert-body">{children}</div>
      {(action || onDismiss) && (
        <div className="alert-actions">
          {action}
          {onDismiss && (
            <button
              type="button"
              className="alert-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
