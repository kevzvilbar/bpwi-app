'use client';

import {
  TECHNICAL_COLUMNS,
  PROJECT_COLUMNS,
  FORM_CODE,
  FORM_REV,
  FORM_TITLE,
  FORM_FOOTER_NOTE,
  type AccomplishmentEntry,
} from '@/lib/accomplishment-form';

interface Props {
  reportDate: string;
  entries: AccomplishmentEntry[];
  preparedByName: string;
  preparedByTitle: string;
  checkedByName?: string | null;
  checkedByTitle?: string | null;
  status?: 'draft' | 'submitted' | 'checked' | 'returned';
  submittedAt?: string | null;
  checkedAt?: string | null;
  minRows?: number;
}

function formatLongDate(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d).toUpperCase();
}

export default function AccomplishmentFormSheet({
  reportDate,
  entries,
  preparedByName,
  preparedByTitle,
  checkedByName,
  checkedByTitle,
  status,
  submittedAt,
  checkedAt,
  minRows = 14,
}: Props) {
  const paddedCount = Math.max(0, minRows - entries.length);
  const emptyRows = Array.from({ length: paddedCount });

  return (
    <div className="bpems-sheet-wrap" style={{ overflowX: 'auto' }}>
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          .bpems-sheet-wrap { overflow: visible !important; }
          .bpems-sheet { box-shadow: none !important; border: none !important; width: 100% !important; min-width: 0 !important; padding: 0 !important; }
        }
        .bpems-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-family: Arial, Helvetica, sans-serif;
          color: #0f172a;
        }
        .bpems-table th, .bpems-table td {
          border: 1px solid #334155;
          padding: 2px 3px;
          font-size: 9.5px;
          line-height: 1.2;
          vertical-align: middle;
        }
        .bpems-table thead th {
          background: #f1f5f9;
          font-weight: 700;
          text-align: center;
          color: #0f172a;
        }
        .bpems-subhdr {
          font-size: 6.8px !important;
          letter-spacing: -0.02em;
          word-break: normal;
          overflow-wrap: break-word;
          height: 28px;
          padding: 2px 2px !important;
        }
        .bpems-chk {
          text-align: center;
          font-weight: 700;
          font-size: 11px !important;
        }
      `}</style>

      <div
        className="bpems-sheet"
        style={{
          background: '#ffffff',
          color: '#0f172a',
          padding: '14px 16px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          minWidth: 1020,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpwi-logo.svg" alt="BPWI Logo" style={{ width: 52, height: 36, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', color: '#0f172a' }}>
              {FORM_TITLE}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
              DATE:{' '}
              <span style={{ borderBottom: '1px solid #0f172a', padding: '0 24px 1px 6px', display: 'inline-block', minWidth: 170 }}>
                {formatLongDate(reportDate)}
              </span>
            </div>
          </div>
          {status && (
            <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: status === 'checked' ? '#15803d' : status === 'submitted' ? '#0369a1' : status === 'returned' ? '#b91c1c' : '#64748b' }}>
              {status === 'checked' ? '✓ CHECKED BY HEAD' : status === 'submitted' ? 'SUBMITTED FOR REVIEW' : status === 'returned' ? 'RETURNED FOR REVISION' : 'DRAFT'}
            </div>
          )}
        </div>

        {/* Exact BPEMS-F-002 Table */}
        <table className="bpems-table">
          <colgroup>
            {/* 7 TECHNICAL + 7 PROJECT = 14 narrow columns */}
            {Array.from({ length: 14 }).map((_, i) => (
              <col key={`c-${i}`} style={{ width: '3.2%' }} />
            ))}
            {/* OTHERS (SPECIFY) */}
            <col style={{ width: '4.5%' }} />
            {/* LOCATION: PROJECT, PH, BLK, LOT */}
            <col style={{ width: '5.5%' }} />
            <col style={{ width: '2.6%' }} />
            <col style={{ width: '2.6%' }} />
            <col style={{ width: '2.6%' }} />
            {/* TIME: STARTED, FINISHED */}
            <col style={{ width: '4.8%' }} />
            <col style={{ width: '4.8%' }} />
            {/* REMARKS */}
            <col style={{ width: '27.8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={7}>TECHNICAL</th>
              <th colSpan={7}>PROJECT</th>
              <th rowSpan={2} className="bpems-subhdr">OTHERS (SPECIFY)</th>
              <th colSpan={4}>LOCATION</th>
              <th colSpan={2}>TIME</th>
              <th rowSpan={2}>REMARKS</th>
            </tr>
            <tr>
              {TECHNICAL_COLUMNS.map((c) => (
                <th key={c.id} className="bpems-subhdr">{c.label}</th>
              ))}
              {PROJECT_COLUMNS.map((c) => (
                <th key={c.id} className="bpems-subhdr">{c.label}</th>
              ))}
              <th className="bpems-subhdr">PROJECT</th>
              <th className="bpems-subhdr">PH</th>
              <th className="bpems-subhdr">BLK</th>
              <th className="bpems-subhdr">LOT</th>
              <th className="bpems-subhdr">STARTED</th>
              <th className="bpems-subhdr">FINISHED</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.id} style={{ height: 22 }}>
                {TECHNICAL_COLUMNS.map((c) => (
                  <td key={c.id} className="bpems-chk">
                    {row.column_id === c.id ? '✓' : ''}
                  </td>
                ))}
                {PROJECT_COLUMNS.map((c) => (
                  <td key={c.id} className="bpems-chk">
                    {row.column_id === c.id ? '✓' : ''}
                  </td>
                ))}
                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                  {!row.column_id ? row.others_specify : ''}
                </td>
                <td style={{ textAlign: 'center' }}>{row.location_project}</td>
                <td style={{ textAlign: 'center' }}>{row.location_ph}</td>
                <td style={{ textAlign: 'center' }}>{row.location_blk}</td>
                <td style={{ textAlign: 'center' }}>{row.location_lot}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{row.time_started}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{row.time_finished}</td>
                <td style={{ textAlign: 'left', paddingLeft: 5 }}>{row.remarks}</td>
              </tr>
            ))}
            {emptyRows.map((_, idx) => (
              <tr key={`empty-${idx}`} style={{ height: 20 }}>
                {Array.from({ length: 22 }).map((__, cIdx) => (
                  <td key={cIdx}>&nbsp;</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer Note */}
        <div style={{ fontSize: 7.5, fontWeight: 600, marginTop: 4, lineHeight: 1.3, color: '#1e293b' }}>
          {FORM_FOOTER_NOTE}
        </div>

        {/* Sign-offs & Form Code */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18, fontSize: 10 }}>
          <div style={{ minWidth: 250 }}>
            <div style={{ fontWeight: 600, marginBottom: 14 }}>Prepared by:</div>
            <div style={{ borderBottom: '1px solid #0f172a', paddingBottom: 2, fontWeight: 700, textTransform: 'uppercase' }}>
              {preparedByName || '\u00A0'}
            </div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
              {preparedByTitle || 'Project & Maintenance Staff'}
              {submittedAt ? ` · Sent ${new Date(submittedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          </div>

          <div style={{ minWidth: 250 }}>
            <div style={{ fontWeight: 600, marginBottom: 14 }}>Checked by:</div>
            <div style={{ borderBottom: '1px solid #0f172a', paddingBottom: 2, fontWeight: 700, textTransform: 'uppercase' }}>
              {checkedByName || '\u00A0'}
            </div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
              {checkedByTitle || 'Project Head/Technical Head'}
              {checkedAt ? ` · Checked ${new Date(checkedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </div>
          </div>

          <div style={{ textAlign: 'right', fontSize: 8.5, color: '#475569', lineHeight: 1.3 }}>
            <div style={{ fontWeight: 700 }}>{FORM_CODE}</div>
            <div>{FORM_REV}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
