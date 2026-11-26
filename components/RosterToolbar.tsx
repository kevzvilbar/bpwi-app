'use client';

import Link from 'next/link';
import { MonthPickerButton } from '@/components/ui';
import type { ChangeRequestItem } from '@/lib/profile';
import {
  DEFAULT_STATION_CODE,
  findOffShift,
  isOffPartnerArea,
  type Area,
  type CopiedScheduleBlock,
  type Shift,
  type ToolMode,
} from '@/lib/roster-helpers';

interface RosterToolbarProps {
  month: string;
  today: string;
  orgId: string;
  role: string;
  canEdit: boolean;
  canOperate: boolean;
  isPropose: boolean;
  hasLinkedOp: boolean;
  onlyMe: boolean;
  onToggleOnlyMe: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  isPending: boolean;
  onGoMonth: (delta: number) => void;
  onSelectMonth: (month: string) => void;
  onGoToday: () => void;
  todayCoverage: { duty: number; sb: number; off: number; leave: number };
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  msg: string;
  mobileToolsOpen: boolean;
  onToggleMobileTools: () => void;
  brushLabel: string;
  onExportCsv: () => void;
  onPrint: () => void;
  onOpenImport: () => void;
  showHint: boolean;
  onDismissHint: () => void;
  shifts: Shift[];
  areas: Area[];
  mode: ToolMode;
  setMode: (m: ToolMode) => void;
  copyStep: 'select' | 'paste';
  copiedBlock: CopiedScheduleBlock | null;
  onToggleCopyMode: () => void;
  onResetCopySource: () => void;
  shiftId: string | null;
  setShiftId: (id: string | null) => void;
  areaId: string | null;
  setAreaId: (id: string | null) => void;
  standbyType: 'OC' | 'DWP' | 'ERP';
  setStandbyType: (t: 'OC' | 'DWP' | 'ERP') => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  draftItems: ChangeRequestItem[];
  onDiscardDrafts: () => void;
}

export default function RosterToolbar(p: RosterToolbarProps) {
  const offShift = findOffShift(p.shifts);
  return (
    <>
      <h1 className="sr-only">Plant Operations Monthly Schedule</h1>
      {/* Action & Filter Bar */}
      <div
        className="no-print card mobile-toolbar-compact"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 8,
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn" onClick={() => p.onGoMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <MonthPickerButton value={p.month} onChange={p.onSelectMonth} ariaLabel="Select month" />
          <button className="btn" onClick={() => p.onGoMonth(1)} aria-label="Next month">
            ›
          </button>
          <button className="btn" onClick={p.onGoToday}>
            {p.isPending ? 'Loading…' : 'Today'}
          </button>
        </div>

        <input
          id="filterInput"
          type="search"
          aria-label="Filter operators"
          placeholder="Filter operator…"
          value={p.search}
          onChange={(e) => p.onSearchChange(e.target.value)}
          className="input"
          style={{ width: 170, minHeight: 36, padding: '5px 10px', fontSize: 12.5 }}
        />

        {p.hasLinkedOp && (
          <button
            type="button"
            className={`btn ${p.onlyMe ? 'btn-primary' : ''}`}
            aria-pressed={p.onlyMe}
            onClick={p.onToggleOnlyMe}
            style={{ fontSize: 12.5, fontWeight: 700 }}
          >
            My Schedule
          </button>
        )}

        <div className="desktop-only" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
          <strong style={{ color: 'var(--text)' }}>Today ({p.today}):</strong>
          <span style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {p.todayCoverage.duty} On Duty
          </span>
          <span style={{ background: 'var(--violet-bg)', color: 'var(--violet-fg)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {p.todayCoverage.sb} Standby
          </span>
          <span style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
            {p.todayCoverage.off} Off
          </span>
          <span style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
            {p.todayCoverage.leave} Leave
          </span>
        </div>

        <span
          aria-live="polite"
          className={p.saveState === 'idle' ? 'mobile-hide-idle-spacer' : undefined}
          style={{
            minWidth: 96,
            fontSize: 12,
            color: p.saveState === 'error' ? 'var(--danger)' : p.saveState === 'saved' ? 'var(--ok-fg)' : 'var(--accent)',
            fontWeight: 600,
            visibility: p.saveState === 'idle' ? 'hidden' : 'visible',
          }}
        >
          {p.saveState === 'saving' ? 'Saving…' : p.saveState === 'saved' ? 'Saved ✓' : p.saveState === 'error' ? 'Not saved' : ''}
        </span>

        {p.msg && (
          <span role="alert" style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}>
            {p.msg}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {p.isPropose && (
            <span
              className="mobile-only-block"
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                background: 'var(--warn-bg)',
                color: 'var(--warn-fg)',
                border: '1px solid var(--warn-border)',
                fontSize: 11.5,
                fontWeight: 700,
              }}
            >
              Propose · needs approval
            </span>
          )}
          {/* Viewers have no brush; their legend is always visible, so the toggle would do nothing. */}
          {p.canOperate && (
            <button
              className="btn mobile-only-block"
              style={{ display: undefined }}
              onClick={p.onToggleMobileTools}
              aria-expanded={p.mobileToolsOpen}
            >
              {p.mobileToolsOpen ? 'Hide Brush & Legend' : `Brush: ${p.brushLabel}`}
            </button>
          )}
          <button className="btn desktop-only" onClick={p.onExportCsv}>
            Export CSV
          </button>
          <button className="btn desktop-only" onClick={p.onPrint}>
            Print
          </button>
          {p.role === 'admin' && (
            <button className="btn desktop-only" onClick={p.onOpenImport}>
              Import JSON
            </button>
          )}
        </div>
      </div>

      {!p.orgId && (
        <div
          className="no-print"
          role="status"
          style={{
            marginBottom: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            color: 'var(--warn-fg)',
            fontSize: 12.5,
          }}
        >
          Your account is signed in and pending administrator activation / organization assignment.
        </div>
      )}

      {p.showHint && p.canOperate && (
        <div
          className="no-print"
          role="note"
          style={{
            marginBottom: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--info-bg)',
            border: '1px solid var(--info-border)',
            color: 'var(--info-fg)',
            fontSize: 12.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            <b>Quick tips:</b> Click or drag across cells to paint. Use arrow keys + Enter for keyboard editing, <code>Ctrl+Z</code> to undo, and right-click (or long-press on mobile) for standby &amp; bulk fill actions.
          </span>
          <button className="btn" style={{ padding: '3px 10px', minHeight: 30, fontSize: 12 }} onClick={p.onDismissHint}>
            Got it
          </button>
        </div>
      )}

      {/* Shift Legend (for viewers, print, or mobile drawer toggle) */}
      {(!p.canOperate || p.mobileToolsOpen) && (
        <div
          className="card"
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 8,
            padding: '6px 12px',
            fontSize: 11.5,
          }}
        >
          <strong style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: 10.5 }}>Shift Legend:</strong>
          {p.shifts.map((s) => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  background: s.background_color,
                  color: s.text_color,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {s.code}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{s.description ?? (s.is_off ? 'Off' : 'Duty')}</span>
            </span>
          ))}
          <span style={{ color: 'var(--text-secondary)' }}>· Duty cells without an area code show <b>{DEFAULT_STATION_CODE}</b></span>
        </div>
      )}

      {/* Paint Palette Bar (Editors and Proposers; collapsible on mobile) */}
      {p.canOperate && (
        <div
          className={`no-print card ${p.mobileToolsOpen ? '' : 'desktop-only'}`}
          style={{
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 8,
            padding: '7px 12px',
          }}
        >
          {(() => {
            const primaryModeLabel = p.isPropose
              ? 'Propose Mode · Draft → Approval'
              : p.canEdit && p.role === 'manager'
                ? 'Direct Edit Mode · Live Window'
                : 'Direct Edit Mode';
            const modeSelectBg = p.mode === 'copy'
              ? 'var(--primary)'
              : p.isPropose
                ? 'var(--warn-bg)'
                : p.canEdit && p.role === 'manager'
                  ? 'var(--ok-bg)'
                  : 'var(--info-bg)';
            const modeSelectFg = p.mode === 'copy'
              ? 'var(--primary-fg)'
              : p.isPropose
                ? 'var(--warn-fg)'
                : p.canEdit && p.role === 'manager'
                  ? 'var(--ok-fg)'
                  : 'var(--info-fg)';
            const modeSelectBorder = p.mode === 'copy'
              ? 'var(--primary)'
              : p.isPropose
                ? 'var(--warn-border)'
                : p.canEdit && p.role === 'manager'
                  ? 'var(--ok-border)'
                  : 'var(--info-border)';
            const modeTitle = p.mode === 'copy'
              ? 'Copy existing cell(s) or a multi-day block and paste onto any target date or operator'
              : p.isPropose
                ? 'Edits save as draft change requests for admin approval'
                : p.canEdit && p.role === 'manager'
                  ? 'Admin edit window is active — changes save directly to the live schedule'
                  : 'Changes save directly to the live schedule';
            return (
              <select
                aria-label="Roster edit mode"
                title={modeTitle}
                value={p.mode === 'copy' ? 'copy' : 'direct'}
                onChange={(e) => (e.target.value === 'copy' ? p.onToggleCopyMode() : p.setMode('paint'))}
                style={{
                  padding: '3px 8px',
                  borderRadius: 5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: modeSelectBg,
                  color: modeSelectFg,
                  border: `1px solid ${modeSelectBorder}`,
                  marginRight: 2,
                }}
              >
                <option value="direct" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                  {primaryModeLabel}
                </option>
                <option value="copy" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                  Copy &amp; Paste Mode
                </option>
              </select>
            );
          })()}

          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: p.mode === 'copy' ? 'var(--info-bg)' : 'var(--primary)',
              color: p.mode === 'copy' ? 'var(--info-fg)' : 'var(--primary-fg)',
              border: p.mode === 'copy' ? '1px solid var(--info-border)' : undefined,
              fontSize: 11.5,
              fontWeight: 700,
              marginRight: 4,
            }}
          >
            {p.mode === 'copy'
              ? (p.copiedBlock ? `Copied: ${p.copiedBlock.label}` : 'Select cells to copy')
              : `Brush: ${p.brushLabel}`}
          </span>
          {p.mode === 'copy' && p.copiedBlock && (
            <button
              type="button"
              className="btn"
              onClick={p.onResetCopySource}
              style={{ padding: '2px 8px', minHeight: 24, fontSize: 11, fontWeight: 600, marginRight: 2 }}
            >
              Pick New Source
            </button>
          )}

          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Shifts:</span>
          {p.shifts.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                p.setMode('paint');
                p.setShiftId(s.id);
              }}
              title={i < 9 ? `${s.description ?? s.code} (Key ${i + 1})` : (s.description ?? '')}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                background: s.background_color,
                color: s.text_color,
                border: p.mode === 'paint' && p.shiftId === s.id ? '2px solid var(--primary)' : '1px solid var(--border)',
              }}
            >
              {s.code}
            </button>
          ))}

          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Area / Leave:</span>
          <button
            onClick={() => {
              p.setMode('paint');
              p.setAreaId(null);
            }}
            style={{
              padding: '3px 8px',
              borderRadius: 5,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--surface-muted)',
              color: 'var(--text)',
              border: p.mode === 'paint' && p.areaId === null ? '2px solid var(--primary)' : '1px solid var(--border)',
            }}
          >
            {DEFAULT_STATION_CODE} (default)
          </button>
          {p.areas.map((a) => {
            const isOffPartner = isOffPartnerArea(a);
            return (
              <button
                key={a.id}
                onClick={() => {
                  p.setMode('paint');
                  p.setAreaId(a.id);
                }}
                title={
                  isOffPartner
                    ? `${a.name ?? a.code} (auto-paired with ${offShift?.code ?? 'OFF'})`
                    : (a.name ?? '')
                }
                className={isOffPartner ? 'cell-leave' : undefined}
                style={{
                  padding: '3px 7px',
                  borderRadius: 5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: isOffPartner ? (offShift?.background_color ?? a.background_color) : a.background_color,
                  color: a.text_color,
                  border: p.mode === 'paint' && p.areaId === a.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                }}
              >
                {a.code}
              </button>
            );
          })}

          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn"
              onClick={() => p.setMode(p.mode === 'standby' ? 'paint' : 'standby')}
              style={{
                padding: '3px 9px',
                fontSize: 11.5,
                border: p.mode === 'standby' ? '2px solid var(--violet)' : '1px solid var(--border)',
                background: p.mode === 'standby' ? 'var(--violet-bg)' : 'var(--surface-muted)',
                color: p.mode === 'standby' ? 'var(--violet-fg)' : 'var(--text)',
                fontWeight: 700,
              }}
            >
              Standby ({p.standbyType})
            </button>
            {p.mode === 'standby' && (
              <select
                aria-label="Standby type"
                value={p.standbyType}
                onChange={(e) => p.setStandbyType(e.target.value as 'OC' | 'DWP' | 'ERP')}
                style={{
                  padding: '3px 6px',
                  borderRadius: 5,
                  border: '1px solid var(--violet)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--violet-fg)',
                  background: 'var(--surface-muted)',
                }}
              >
                <option value="OC">OC · General</option>
                <option value="DWP">DWP · Deep Well</option>
                <option value="ERP">ERP · Electro-Mech</option>
              </select>
            )}
          </div>

          <button
            className="btn"
            onClick={() => p.setMode(p.mode === 'erase' ? 'paint' : 'erase')}
            style={{
              padding: '3px 9px',
              fontSize: 11.5,
              border: p.mode === 'erase' ? '2px solid var(--danger)' : '1px solid var(--border)',
              background: p.mode === 'erase' ? 'var(--danger-bg)' : 'var(--surface-muted)',
              color: p.mode === 'erase' ? 'var(--danger-fg)' : 'var(--text)',
              fontWeight: 600,
            }}
          >
            Clear Cell
          </button>

          <span style={{ width: 1, height: 18, background: 'var(--border-light)', margin: '0 3px' }} />
          <button className="btn" onClick={p.onUndo} disabled={!p.canUndo} style={{ padding: '3px 8px', fontSize: 11.5 }} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn" onClick={p.onRedo} disabled={!p.canRedo} style={{ padding: '3px 8px', fontSize: 11.5 }} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <div style={{ width: '100%', fontSize: 11.5, color: 'var(--text-secondary)', paddingTop: 2 }}>
            {p.mode === 'copy'
              ? p.copyStep === 'select' || !p.copiedBlock
                ? 'Copy & Paste mode (Step 1 — Copy): click or drag across existing cells to copy a single shift or multi-day block.'
                : `Copy & Paste mode (Step 2 — Paste): click any target cell to paste ${p.copiedBlock.label} (works across months, Ctrl+Z to undo), or click Pick New Source.`
              : p.mode === 'paint'
                ? `Paint mode: click or drag across cells to apply ${p.brushLabel}.`
                : p.mode === 'standby'
                  ? `Standby mode: click a cell to toggle ${p.standbyType} standby status.`
                  : 'Erase mode: click or drag across cells to clear shift assignments.'}
          </div>
        </div>
      )}

      {p.canEdit && p.role === 'manager' && p.draftItems.length > 0 && (
        <div
          className="no-print card"
          role="status"
          style={{
            marginBottom: 8,
            padding: '8px 12px',
            borderLeft: '4px solid var(--warn-fg)',
            background: 'var(--warn-bg)',
            color: 'var(--warn-fg)',
            fontSize: 12.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>
            <strong>Active Edit Window:</strong> edits now apply directly to the live schedule. You still have{' '}
            <b>{p.draftItems.length}</b> unsubmitted draft proposal item{p.draftItems.length === 1 ? '' : 's'} saved from before this window.
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link href="/requests" className="btn" style={{ padding: '3px 10px', minHeight: 30, fontSize: 12, textDecoration: 'none' }}>
              View Requests
            </Link>
            <button
              type="button"
              className="btn"
              style={{ padding: '3px 10px', minHeight: 30, fontSize: 12, color: 'var(--danger)' }}
              onClick={p.onDiscardDrafts}
            >
              Discard Drafts
            </button>
          </div>
        </div>
      )}
    </>
  );
}
