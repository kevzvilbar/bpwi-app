'use client';

import { useRef } from 'react';

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function formatShortMonthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const idx = Number(m[2]) - 1;
  const name = MONTHS_SHORT[idx];
  return name ? `${name} ${m[1]}` : ym;
}

export interface MonthPickerButtonProps {
  value: string;
  onChange: (month: string) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Displays a compact shortened month label ("Nov 2026 ▾") over a native <input type="month"> picker.
 */
export function MonthPickerButton({
  value,
  onChange,
  ariaLabel = 'Select month',
  className = '',
}: MonthPickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const label = formatShortMonthLabel(value);

  const openPicker = () => {
    const el = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    try {
      el.showPicker?.();
    } catch {
      el.focus();
    }
  };

  return (
    <span className={['month-picker-btn', className].filter(Boolean).join(' ')} onClick={openPicker}>
      <span aria-hidden="true">{label}</span>
      <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>▾</span>
      <input
        ref={inputRef}
        type="month"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          border: 0,
          margin: 0,
        }}
      />
    </span>
  );
}
