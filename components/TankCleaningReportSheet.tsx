'use client';

import type { DailyActivityRow } from '@/lib/activity-types';
import { resolveActivityPhotoUrl } from '@/lib/activity-media';
import {
  DEFAULT_TANK_CLEANING_CONCLUSION,
  DEFAULT_TANK_CLEANING_OBJECTIVE,
  computeTankDowntime,
  evaluateTankWaterQuality,
  formatTankReportNumber,
  hydrateTankCleaningDetails,
  type TankSanitaryClearance,
  type WaterQualityVerdict,
} from '@/lib/tank-cleaning-types';
import {
  formatPulloutDateDisplay,
  normalizePulloutTimeHHMM,
} from '@/lib/well-pullout-types';
import {
  REPORT_ACCENT,
  REPORT_BORDER_LIGHT,
  ReportLetterhead,
  ReportSignatureGrid,
} from '@/components/ReportSheetPrimitives';

type LookupOp = { id: string; full_name: string; position: string | null };

interface TankCleaningReportSheetProps {
  activity: DailyActivityRow;
  orgName: string;
  areaLabel: string;
  leadOp: LookupOp | null;
  crewOps: LookupOp[];
}

const B = REPORT_BORDER_LIGHT;
const ACCENT = REPORT_ACCENT;

const SEC_TITLE: React.CSSProperties = {
  color: ACCENT,
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: '0.03em',
  marginBottom: 4,
  textTransform: 'uppercase',
};

const TH_CELL: React.CSSProperties = {
  background: '#f1f5f9',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 9.5,
  padding: '4px 6px',
  border: B,
  textAlign: 'left',
};

const TD_CELL: React.CSSProperties = {
  fontSize: 9.5,
  padding: '4px 6px',
  border: B,
  color: '#0f172a',
  verticalAlign: 'top',
};

function formatTime12h(raw: string): string {
  const hhmm = normalizePulloutTimeHHMM(raw);
  if (!hhmm) return raw.trim();
  const [hStr, mStr] = hhmm.split(':');
  const h24 = Number(hStr);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${ampm}`;
}

/** Derives the Manila "HH:MM" capture time from an uploaded photo's storage filename (`<epochMs>-<rand>.ext`). */
function photoTimeFromPath(path: string | null | undefined): string {
  const file = (path ?? '').split('/').pop() ?? '';
  const m = /^(\d{13})-/.exec(file);
  if (!m) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(Number(m[1])));
  const hh = parts.find((x) => x.type === 'hour')?.value ?? '';
  const mm = parts.find((x) => x.type === 'minute')?.value ?? '';
  return hh && mm ? `${hh === '24' ? '00' : hh}:${mm}` : '';
}

function clearanceBadgeStyle(status: TankSanitaryClearance): React.CSSProperties {
  if (status === 'CLEARED') {
    return { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' };
  }
  if (status === 'HOLD') {
    return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
  }
  return { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' };
}

function statusPill(v: WaterQualityVerdict): { text: string; bg: string; color: string } {
  if (v === 'PASS') return { text: 'PASS', bg: '#dcfce7', color: '#166534' };
  if (v === 'FAIL') return { text: 'FAIL', bg: '#fee2e2', color: '#991b1b' };
  return { text: '—', bg: '#f8fafc', color: '#64748b' };
}

function ScopeCheck({ checked, title, desc }: { checked: boolean; title: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 9.5, lineHeight: 1.35 }}>
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          marginTop: 1,
          border: `1.5px solid ${checked ? ACCENT : '#64748b'}`,
          background: checked ? ACCENT : '#ffffff',
          color: '#ffffff',
          fontSize: 8.5,
          fontWeight: 900,
          lineHeight: '10px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <div>
        <strong>{title}:</strong> {desc}
      </div>
    </div>
  );
}

export default function TankCleaningReportSheet({
  activity,
  orgName,
  areaLabel,
  leadOp,
  crewOps,
}: TankCleaningReportSheetProps) {
  const tc = hydrateTankCleaningDetails(activity.details ?? {});
  const evalRes = evaluateTankWaterQuality(tc);
  const reportNo = formatTankReportNumber(activity.activity_date, activity.id, tc.reportNo);
  const facilityName = activity.site_or_well || areaLabel || 'N/A';
  const gpsDisplay =
    activity.gps_lat != null && activity.gps_lng != null
      ? `${activity.gps_lat}, ${activity.gps_lng}`
      : 'N/A';
  const capacityDisplay = tc.tankCapacity.trim()
    ? `${tc.tankCapacity.trim()} ${tc.tankCapacityUnit}`
    : 'N/A';
  const tankDesc = [tc.tankId.trim() || activity.site_or_well || '', tc.tankType].filter(Boolean).join(' · ') || 'N/A';
  const startDateFmt = formatPulloutDateDisplay(tc.dateStarted || activity.activity_date);
  const endDateFmt = formatPulloutDateDisplay(tc.dateFinished || tc.dateStarted || activity.activity_date);
  const dateDisplay =
    startDateFmt && endDateFmt && startDateFmt !== endDateFmt
      ? `${startDateFmt} – ${endDateFmt}`
      : startDateFmt || 'N/A';

  const startHHMM = tc.timeStarted || (activity.started_at ? activity.started_at.slice(11, 16) : '');
  const endHHMM = tc.timeFinished || (activity.completed_at ? activity.completed_at.slice(11, 16) : '');
  const timeWindow =
    startHHMM || endHHMM
      ? `${startHHMM ? formatTime12h(startHHMM) : '—'} – ${endHHMM ? formatTime12h(endHHMM) : '—'}`
      : 'N/A';
  const downtimeDisplay =
    tc.totalDowntime.trim() ||
    computeTankDowntime(tc.dateStarted, tc.timeStarted, tc.dateFinished, tc.timeFinished, activity.activity_date) ||
    'N/A';

  const preparedByName = leadOp?.full_name ?? 'Unspecified';
  const preparedByRole = leadOp?.position ?? 'Field Operations Personnel';

  const seenIds = new Set<string>();
  const personnelList: Array<{ name: string; role: string }> = [];
  if (leadOp) {
    seenIds.add(leadOp.id);
    personnelList.push({
      name: leadOp.full_name,
      role: leadOp.position ? `${leadOp.position} (Technical Lead)` : 'Technical Lead',
    });
  }
  for (const op of crewOps) {
    if (seenIds.has(op.id)) continue;
    seenIds.add(op.id);
    personnelList.push({
      name: op.full_name,
      role: op.position || 'Maintenance / Operations Personnel',
    });
  }
  if (personnelList.length === 0) {
    personnelList.push({ name: 'Unspecified', role: 'Field Operations' });
  }

  const urls = activity.photo_urls ?? [];
  const paths = activity.photo_storage_paths ?? [];
  const startPhotoUrl = urls[0] ? resolveActivityPhotoUrl(urls[0], paths[0] ?? null) : '';
  const endIdx = urls.length >= 2 ? urls.length - 1 : -1;
  const endPhotoUrl =
    endIdx >= 0 && urls[endIdx] ? resolveActivityPhotoUrl(urls[endIdx], paths[endIdx] ?? null) : '';
  const isPurged = Boolean(activity.photos_purged_at);
  const purgedLabel = activity.photos_purged_at
    ? new Date(activity.photos_purged_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  const waterRows = [
    {
      param: 'Free Residual Chlorine (mg/L)',
      pre: tc.chlorinePre,
      dis: tc.chlorineDisinfection,
      post: tc.chlorinePost,
      std: '0.30 – 1.50 mg/L',
      verdict: evalRes.chlorine,
    },
    {
      param: 'Turbidity (NTU)',
      pre: tc.turbidityPre,
      dis: 'N/A',
      post: tc.turbidityPost,
      std: '≤ 5.0 NTU',
      verdict: evalRes.turbidity,
    },
    {
      param: 'pH Level',
      pre: tc.phPre,
      dis: tc.phDisinfection,
      post: tc.phPost,
      std: '6.5 – 8.5',
      verdict: evalRes.ph,
    },
    {
      param: 'Odor & Appearance',
      pre: tc.odorPre,
      dis: 'N/A',
      post: tc.odorPost,
      std: 'Unobjectionable',
      verdict: evalRes.odor,
    },
  ];

  const inspectionRows = [
    { comp: 'Interior Walls & Floor', cond: tc.condWallsFloor, rem: tc.remWallsFloor },
    { comp: 'Roof, Ceiling & Manhole Hatch', cond: tc.condRoofHatch, rem: tc.remRoofHatch },
    { comp: 'Air Vents & Overflow Screen', cond: tc.condVentsScreen, rem: tc.remVentsScreen },
    { comp: 'Inlet, Outlet & Drain Valves', cond: tc.condValves, rem: tc.remValves },
    { comp: 'Access Ladder & Level Gauge', cond: tc.condLadderGauge, rem: tc.remLadderGauge },
  ];

  const clearanceText =
    evalRes.overall === 'CLEARED'
      ? 'CLEARED FOR SERVICE'
      : evalRes.overall === 'HOLD'
        ? 'HOLD — REVIEW REQUIRED'
        : 'PENDING VERIFICATION';

  const renderPhotoCard = (
    title: string,
    imgUrl: string,
    timeRaw: string,
    remarks: string,
  ) => (
    <div style={{ border: B, display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...TH_CELL, textAlign: 'center', borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
        {title}
      </div>
      <div
        style={{
          height: 156,
          background: '#f8fafc',
          display: 'grid',
          placeItems: 'center',
          padding: 6,
          borderBottom: B,
          textAlign: 'center',
        }}
      >
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgUrl}
            alt={title}
            style={{ maxWidth: '100%', maxHeight: 144, objectFit: 'contain', borderRadius: 2 }}
          />
        ) : isPurged ? (
          <div style={{ color: '#64748b', fontSize: 9, padding: '0 12px', lineHeight: 1.4 }}>
            <div style={{ fontWeight: 800, color: '#334155', marginBottom: 2 }}>
              PHOTO PURGED (30-DAY RETENTION POLICY)
            </div>
            <div>Automatically deleted on {purgedLabel} to conserve storage.</div>
          </div>
        ) : (
          <span style={{ color: '#94a3b8', fontSize: 9 }}>No photo attached</span>
        )}
      </div>
      <div style={{ padding: '4px 6px', fontSize: 8.8, lineHeight: 1.35, color: '#334155' }}>
        <div><strong>Time Taken:</strong> {timeRaw ? formatTime12h(timeRaw) : 'N/A'}</div>
        <div><strong>GPS Coordinates:</strong> {gpsDisplay}</div>
        <div><strong>Remarks:</strong> {remarks.trim() || '—'}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 10, color: '#0f172a', fontFamily: 'Arial, sans-serif' }}>
      <ReportLetterhead
        variant="accent"
        orgName={orgName}
        eyebrow={`${orgName || 'BP Waterworks, Inc.'} · Operational Maintenance & Water Quality Assurance`}
        title="Tank Cleaning & Sanitation Accomplishment Report"
        refCode={reportNo}
        rightSlot={
          <span
            style={{
              ...clearanceBadgeStyle(evalRes.overall),
              padding: '2px 7px',
              borderRadius: 4,
              fontSize: 8.5,
              fontWeight: 800,
              letterSpacing: '0.03em',
            }}
          >
            {clearanceText}
          </span>
        }
      />

      {/* Metadata Summary Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <th style={{ ...TH_CELL, width: '18%' }}>Facility / Site Name</th>
            <td style={{ ...TD_CELL, width: '32%', fontWeight: 700 }}>{facilityName}</td>
            <th style={{ ...TH_CELL, width: '18%' }}>Report No.</th>
            <td style={{ ...TD_CELL, width: '32%', fontWeight: 700 }}>{reportNo}</td>
          </tr>
          <tr>
            <th style={TH_CELL}>GPS Coordinates</th>
            <td style={TD_CELL}>{gpsDisplay}</td>
            <th style={TH_CELL}>Tank Capacity</th>
            <td style={TD_CELL}>{capacityDisplay}</td>
          </tr>
          <tr>
            <th style={TH_CELL}>Tank ID &amp; Type</th>
            <td style={TD_CELL}>{tankDesc}</td>
            <th style={TH_CELL}>Date Conducted</th>
            <td style={TD_CELL}>{dateDisplay}</td>
          </tr>
          <tr>
            <th style={TH_CELL}>Time Window</th>
            <td style={TD_CELL}>{timeWindow}</td>
            <th style={TH_CELL}>Total Downtime</th>
            <td style={TD_CELL}>{downtimeDisplay}</td>
          </tr>
          <tr>
            <th style={TH_CELL}>Prepared By</th>
            <td colSpan={3} style={TD_CELL}>
              <strong>{preparedByName}</strong> ({preparedByRole})
            </td>
          </tr>
        </tbody>
      </table>

      {/* 1. Objective */}
      <div>
        <div style={SEC_TITLE}>1. Objective</div>
        <div style={{ fontSize: 9.5, lineHeight: 1.4, color: '#1e293b' }}>
          {tc.objective || DEFAULT_TANK_CLEANING_OBJECTIVE}
        </div>
      </div>

      {/* 2. Scope of Work & Execution Summary */}
      <div>
        <div style={SEC_TITLE}>2. Scope of Work &amp; Execution Summary</div>
        <div style={{ display: 'grid', gap: 4 }}>
          <ScopeCheck
            checked={tc.scopeSystemIsolation}
            title="System Isolation"
            desc={
              tc.scopeBypassEngaged
                ? 'Closed inlet and outlet isolation valves; engaged bypass line to maintain distribution pressure.'
                : 'Closed inlet and outlet isolation valves (bypass line not engaged / not applicable).'
            }
          />
          <ScopeCheck
            checked={tc.scopeDrainingSludge}
            title="Draining & Sludge Removal"
            desc="Drained residual water via washout valve and removed accumulated bottom sediments and sludge."
          />
          <ScopeCheck
            checked={tc.scopeSurfaceScrubbing}
            title="Surface Scrubbing & Washing"
            desc="Scrubbed and pressure-rinsed interior walls, floor, columns, baffles, and internal fittings."
          />
          <ScopeCheck
            checked={tc.scopeDisinfection}
            title="Disinfection & Sanitization"
            desc={`Applied chlorine disinfection solution at ${tc.chlorineDisinfection.trim() || tc.disinfectionConcentrationPpm || '—'} ppm concentration for a contact time of ${tc.disinfectionContactTime || '—'}.`}
          />
          <ScopeCheck
            checked={tc.scopeFlushingRefilling}
            title="Flushing & Refilling"
            desc="Safely discharged chlorinated wash water, flushed interior surfaces with potable water, and refilled tank."
          />
          <ScopeCheck
            checked={tc.scopeCommissioning}
            title="Commissioning & Verification"
            desc="Verified water quality parameters prior to reopening distribution valves and restoring normal service."
          />
        </div>
      </div>

      {/* 3. Water Quality & Disinfection Log */}
      <div>
        <div style={SEC_TITLE}>3. Water Quality &amp; Disinfection Log (PNSDW Standard)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH_CELL}>Parameter</th>
              <th style={{ ...TH_CELL, textAlign: 'center' }}>Pre-Cleaning</th>
              <th style={{ ...TH_CELL, textAlign: 'center' }}>Disinfection</th>
              <th style={{ ...TH_CELL, textAlign: 'center' }}>Post-Cleaning</th>
              <th style={{ ...TH_CELL, textAlign: 'center' }}>Target Standard</th>
              <th style={{ ...TH_CELL, textAlign: 'center', width: 58 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {waterRows.map((r) => {
              const pill = statusPill(r.verdict);
              return (
                <tr key={r.param}>
                  <td style={{ ...TD_CELL, fontWeight: 700 }}>{r.param}</td>
                  <td style={{ ...TD_CELL, textAlign: 'center' }}>{r.pre || '—'}</td>
                  <td style={{ ...TD_CELL, textAlign: 'center' }}>{r.dis || '—'}</td>
                  <td style={{ ...TD_CELL, textAlign: 'center', fontWeight: 700 }}>{r.post || '—'}</td>
                  <td style={{ ...TD_CELL, textAlign: 'center' }}>{r.std}</td>
                  <td style={{ ...TD_CELL, textAlign: 'center', fontWeight: 800, background: pill.bg, color: pill.color }}>
                    {pill.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 9, marginTop: 4, color: '#1e293b' }}>
          <strong>Disinfectant Used:</strong> {tc.disinfectantUsed || 'N/A'} |{' '}
          <strong>Total Quantity Used:</strong> {tc.disinfectantQuantity || 'N/A'}
        </div>
      </div>

      {/* 4. Physical Inspection & Observations */}
      <div style={{ breakInside: 'avoid' }}>
        <div style={SEC_TITLE}>4. Physical Inspection &amp; Observations</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH_CELL, width: '32%' }}>Facility Component</th>
              <th style={{ ...TH_CELL, width: '16%', textAlign: 'center' }}>Condition</th>
              <th style={TH_CELL}>Remarks / Findings</th>
            </tr>
          </thead>
          <tbody>
            {inspectionRows.map((row) => (
              <tr key={row.comp}>
                <td style={{ ...TD_CELL, fontWeight: 700 }}>{row.comp}</td>
                <td style={{ ...TD_CELL, textAlign: 'center', fontWeight: 700 }}>{row.cond || '—'}</td>
                <td style={TD_CELL}>{row.rem || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div
          style={{
            marginTop: 6,
            borderLeft: `3px solid ${ACCENT}`,
            background: '#f8fafc',
            padding: '5px 8px',
            fontSize: 9.2,
            lineHeight: 1.4,
          }}
        >
          <strong>Conclusion &amp; Recommendations:</strong>{' '}
          {tc.conclusionRecommendations.trim() || activity.notes || DEFAULT_TANK_CLEANING_CONCLUSION}
          {tc.nextScheduledCleaningDate.trim() && (
            <div style={{ marginTop: 2 }}>
              <strong>Next Scheduled Cleaning Date:</strong>{' '}
              {formatPulloutDateDisplay(tc.nextScheduledCleaningDate)}
            </div>
          )}
        </div>
      </div>

      {/* 5. Manpower Involved */}
      <div style={{ breakInside: 'avoid' }}>
        <div style={SEC_TITLE}>5. Manpower Involved</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH_CELL, width: 40, textAlign: 'center' }}>No.</th>
              <th style={{ ...TH_CELL, width: '46%' }}>Personnel Name</th>
              <th style={TH_CELL}>Designation / Role</th>
            </tr>
          </thead>
          <tbody>
            {personnelList.map((person, idx) => (
              <tr key={`${person.name}-${idx}`}>
                <td style={{ ...TD_CELL, textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ ...TD_CELL, fontWeight: 700 }}>{person.name}</td>
                <td style={TD_CELL}>{person.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 6. Photo Documentation (Start & End) */}
      <div style={{ breakInside: 'avoid' }}>
        <div style={SEC_TITLE}>6. Photo Documentation (Start &amp; End)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {renderPhotoCard(
            'Start of Activity (Pre-Cleaning / Initial Condition)',
            startPhotoUrl,
            tc.startPhotoTime || photoTimeFromPath(paths[0]) || startHHMM,
            tc.startPhotoRemarks,
          )}
          {renderPhotoCard(
            'End of Activity (Post-Cleaning / Sanitized Condition)',
            endPhotoUrl,
            tc.endPhotoTime || (endIdx >= 0 ? photoTimeFromPath(paths[endIdx]) : '') || endHHMM,
            tc.endPhotoRemarks,
          )}
        </div>
        <div style={{ fontSize: 8.2, color: '#64748b', marginTop: 3 }}>
          Retention Policy: Attached field photos are automatically deleted 30 days after upload to conserve storage.
        </div>
      </div>

      {/* 7. Sign-Off & Verification */}
      <div style={{ breakInside: 'avoid' }}>
        <div style={SEC_TITLE}>7. Sign-Off &amp; Verification</div>
        <ReportSignatureGrid
          variant="boxed"
          entries={[
            {
              topLabel: 'Prepared By',
              printedName: preparedByName,
              roleTitle: 'Prepared By',
              subtitle: `${preparedByRole} · Date: __________`,
            },
            {
              topLabel: 'Noted By',
              printedName: tc.notedByName || ' ',
              roleTitle: 'Noted By',
              subtitle: 'Technical Head / Supervisor · Date: __________',
            },
            {
              topLabel: 'Approved By',
              printedName: tc.approvedByName || ' ',
              roleTitle: 'Approved By',
              subtitle: 'Manager / Unit Head · Date: __________',
            },
          ]}
        />
      </div>
    </div>
  );
}
