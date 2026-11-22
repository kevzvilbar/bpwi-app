'use client';

import type { ReactNode } from 'react';

export interface SegmentedTabItem<T extends string> {
  id: T;
  label: ReactNode;
}

export interface SegmentedTabsProps<T extends string> {
  ariaLabel: string;
  items: ReadonlyArray<SegmentedTabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedTabs<T extends string>({
  ariaLabel,
  items,
  value,
  onChange,
  fullWidth = false,
  size = 'md',
  className = '',
}: SegmentedTabsProps<T>) {
  const classes = [
    'segmented-tabs',
    fullWidth ? 'segmented-tabs-full' : '',
    size === 'sm' ? 'segmented-tabs-sm' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div role="tablist" aria-label={ariaLabel} className={classes}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className="segmented-tab"
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
