'use client';

import type { CSSProperties, ReactNode } from 'react';

/** Fixed high-contrast print document tokens (intentionally theme-independent for physical paper). */
export const BPWI_COMPANY_ADDRESS =
  "Unit 1B–5B 2nd Floor, 5J's Commercial Building, Zone 7 Rd 8, Don Julio Subd., Pavia, Iloilo · Tel. (0917) 631-1427";

export const REPORT_BORDER = '1px solid #1e293b';
export const REPORT_BORDER_HEAVY = '1.5px solid #0f172a';
export const REPORT_BORDER_LIGHT = '1px solid #cbd5e1';
export const REPORT_ACCENT = '#0369a1';

export const REPORT_TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};

export const REPORT_TH_STYLE: CSSProperties = {
  borderBottom: REPORT_BORDER,
  borderRight: REPORT_BORDER,
  padding: '4px 8px',
  background: '#f1f5f9',
  color: '#0f172a',
  fontWeight: 800,
  textAlign: 'left',
};

export const REPORT_TD_STYLE: CSSProperties = {
  borderBottom: REPORT_BORDER,
  borderRight: REPORT_BORDER,
  padding: '4px 8px',
  color: '#0f172a',
};

export const REPORT_SECTION_BAR_STYLE: CSSProperties = {
  background: '#e2e8f0',
  color: '#0f172a',
  padding: '5px 8px',
  fontWeight: 800,
  fontSize: 11.5,
  borderBottom: REPORT_BORDER,
};

export const REPORT_META_BOX_STYLE: CSSProperties = {
  border: REPORT_BORDER,
  padding: '8px 10px',
  background: '#f8fafc',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '4px 14px',
  fontSize: 11,
};

export function formatReportPrintedTs(ts: string | null | undefined): string {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export interface ReportLetterheadProps {
  orgName: string;
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  refCode: string;
  dateLabel?: string;
  printedTs?: string;
  rightSlot?: ReactNode;
  variant?: 'standard' | 'accent' | 'compact';
}

/** Shared BPWI letterhead with logo, organization name/subtitle, and document reference block. */
export function ReportLetterhead({
  orgName,
  title,
  eyebrow,
  subtitle,
  refCode,
  dateLabel,
  printedTs,
  rightSlot,
  variant = 'standard',
}: ReportLetterheadProps) {
  const isAccent = variant === 'accent';
  const isCompact = variant === 'compact';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: isAccent ? 'flex-end' : 'center',
        borderBottom: isCompact ? 'none' : isAccent ? `2px solid ${REPORT_ACCENT}` : '2px solid #0f172a',
        paddingBottom: isCompact ? 2 : isAccent ? 6 : eyebrow ? 12 : 10,
        marginBottom: isCompact || isAccent ? 0 : eyebrow ? 18 : 0,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: isAccent || isCompact ? 10 : 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bpwi-logo.png"
          alt="BP Waterworks, Inc."
          style={{
            width: isCompact ? 44 : isAccent ? 48 : 52,
            height: isCompact ? 33 : isAccent ? 36 : 39,
            objectFit: 'contain',
          }}
        />
        <div>
          {eyebrow ? (
            <div
              style={{
                fontSize: isAccent ? 9 : 11,
                fontWeight: isAccent ? 800 : 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: isAccent ? REPORT_ACCENT : '#334155',
              }}
            >
              {eyebrow}
            </div>
          ) : (
            <div
              style={{
                fontWeight: 800,
                fontSize: isCompact ? 12.5 : 13,
                letterSpacing: isCompact ? '0.02em' : undefined,
              }}
            >
              {orgName || 'BP Waterworks, Inc.'}
            </div>
          )}

          {subtitle && (
            <div style={{ fontSize: isCompact ? 8.2 : 10, color: '#475569' }}>{subtitle}</div>
          )}

          {title && (
            <h1
              style={{
                margin: eyebrow ? 0 : '2px 0 0',
                fontSize: eyebrow ? (isAccent ? 15.5 : 19) : 15,
                fontWeight: 800,
                color: '#0f172a',
                textTransform: eyebrow ? 'uppercase' : undefined,
                letterSpacing: isAccent ? undefined : '0.03em',
              }}
            >
              {title}
            </h1>
          )}
        </div>
      </div>

      <div
        style={{
          textAlign: 'right',
          fontSize: isCompact ? 8.2 : 11,
          display: rightSlot ? 'grid' : undefined,
          gap: rightSlot ? 3 : undefined,
          justifyItems: rightSlot ? 'end' : undefined,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: isCompact ? 10 : eyebrow && !isAccent ? 15 : 13.5 }}>
          {refCode}
        </div>
        {dateLabel && (
          <div style={{ color: isCompact || (eyebrow && !isAccent) ? '#475569' : undefined }}>
            {dateLabel}
          </div>
        )}
        {printedTs && (
          <div style={{ color: '#475569', fontSize: 10 }}>Printed: {printedTs}</div>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

export interface ReportSignatureEntry {
  topLabel?: string;
  printedName?: string | null;
  signatureUrl?: string | null;
  signatureAlt?: string;
  emptySignatureText?: string;
  roleTitle: string;
  subtitle?: string;
}

export interface ReportSignatureGridProps {
  entries: ReportSignatureEntry[];
  variant?: 'underline' | 'boxed';
  lineHeight?: number;
  gap?: number;
  marginTop?: number;
  fontSize?: number;
}

/** Shared multi-column signatory block for print forms (underline or boxed table layout). */
export function ReportSignatureGrid({
  entries,
  variant = 'underline',
  lineHeight = 34,
  gap = 28,
  marginTop = 22,
  fontSize = 11,
}: ReportSignatureGridProps) {
  if (variant === 'boxed') {
    const colPct = `${(100 / Math.max(1, entries.length)).toFixed(2)}%`;
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', border: REPORT_BORDER_HEAVY }}>
        <thead>
          <tr>
            {entries.map((entry, idx) => (
              <th
                key={idx}
                style={{
                  background: '#f1f5f9',
                  color: '#0f172a',
                  fontWeight: 800,
                  fontSize: 9.5,
                  padding: '4px 6px',
                  border: REPORT_BORDER_LIGHT,
                  textAlign: 'left',
                }}
              >
                {entry.topLabel || entry.roleTitle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {entries.map((entry, idx) => (
              <td
                key={idx}
                style={{
                  fontSize: 9.5,
                  padding: '6px 8px',
                  border: REPORT_BORDER_LIGHT,
                  color: '#0f172a',
                  verticalAlign: 'top',
                  width: colPct,
                }}
              >
                <div style={{ height: 28, borderBottom: '1px solid #0f172a', marginBottom: 4 }} />
                <div style={{ fontWeight: 800, fontSize: 9.5 }}>{entry.printedName || ' '}</div>
                <div style={{ fontSize: 8.5, color: '#475569' }}>
                  {entry.subtitle || entry.roleTitle}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${entries.length}, 1fr)`,
        gap,
        marginTop,
        textAlign: 'center',
        fontSize,
      }}
    >
      {entries.map((entry, idx) => (
        <div key={idx}>
          {entry.topLabel && (
            <div style={{ textAlign: 'left', fontWeight: 700 }}>{entry.topLabel}</div>
          )}
          <div
            style={{
              height: lineHeight,
              borderBottom: '1px solid #0f172a',
              marginBottom: entry.topLabel ? 0 : 4,
              display: 'grid',
              placeItems: entry.signatureUrl ? 'center' : 'end center',
              fontWeight: entry.topLabel ? 800 : 600,
            }}
          >
            {entry.signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.signatureUrl}
                alt={entry.signatureAlt || 'Signature'}
                style={{ maxHeight: Math.max(24, lineHeight - 6), maxWidth: '100%', objectFit: 'contain' }}
              />
            ) : entry.printedName ? (
              entry.printedName
            ) : entry.emptySignatureText ? (
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>
                {entry.emptySignatureText}
              </span>
            ) : null}
          </div>
          {entry.roleTitle && <b>{entry.roleTitle}</b>}
          {entry.subtitle && (
            <div
              style={{
                fontSize: fontSize <= 9 ? 8.2 : Math.max(10, fontSize - 1),
                fontWeight: fontSize <= 9 ? 700 : 400,
                color: fontSize <= 9 ? '#0f172a' : '#475569',
                marginTop: fontSize <= 9 ? 2 : 0,
              }}
            >
              {entry.subtitle}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
