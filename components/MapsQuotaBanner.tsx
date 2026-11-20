'use client';

import { useEffect, useState } from 'react';

const QUOTA_DOCS_URL =
  'https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors';

declare global {
  interface Window {
    gm_authFailure?: () => void;
    __bpwiMapsQuotaPatched?: boolean;
  }
}

export function triggerMapsQuotaExceeded() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

/**
 * Global Google Maps Platform Demo-Key Quota Defense banner (Tier 1 & Tier 2 listener).
 * Mounted in the root layout so quota notifications remain visible even if map tabs unmount.
 */
export default function MapsQuotaBanner() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);

    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      if (typeof prevAuthFailure === 'function') {
        prevAuthFailure();
      }
    };

    const origConsoleError = console.error;
    if (!window.__bpwiMapsQuotaPatched) {
      window.__bpwiMapsQuotaPatched = true;
      console.error = (...args: unknown[]) => {
        try {
          const msg = args.map((a) => String(a ?? '')).join(' ');
          if (/OverQuotaMapError|QuotaExceededError|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
        } catch {
          // ignore inspection errors
        }
        origConsoleError.apply(console, args);
      };
    }

    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
    };
  }, []);

  if (!quotaExceeded) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'var(--warn-bg, #fffbeb)',
        borderBottom: '1px solid var(--warn-border, #f59e0b)',
        color: 'var(--warn-fg, #92400e)',
        padding: '10px 16px',
        fontSize: 13,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span>
        Your Google Maps Platform quota has been exceeded. For next steps, see{' '}
        <a
          href={QUOTA_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline' }}
        >
          Quota Exceeded Errors documentation
        </a>
        .
      </span>
      <button
        type="button"
        onClick={() => setQuotaExceeded(false)}
        aria-label="Dismiss Google Maps quota notice"
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 6,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 8px',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
