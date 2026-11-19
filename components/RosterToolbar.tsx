'use client';

import Link from 'next/link';
import type { ChangeRequestItem } from '@/lib/profile';
import {
  findOffShift,
  isOffPartnerArea,
  type Area,
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
      {/* Action & Filter Bar */}
      <div
        className="no-print card"
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
          <input
            type="month"
            aria-label="Select month"
            value={p.month}
            onChange={(e) => e.target.value && p.onSelectMonth(e.target.value)}
            className="input"
            style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 12.5, fontWeight: 600 }}
          />
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
          <button
            className="btn mobile-only-block"
            style={{ display: undefined }}
            onClick={p.onToggleMobileTools}
            aria-expanded={p.mobileToolsOpen}
          >
            {p.mobileToolsOpen ? 'Hide Brush & Legend' : `Brush: ${p.brushLabel}`}
          </button>
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
          <span style={{ color: 'var(--text-secondary)' }}>· Duty cells without an area code show <b>PW</b></span>
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
          {p.isPropose ? (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                background: 'var(--warn-bg)',
                color: 'var(--warn-fg)',
                fontSize: 11,
                fontWeight: 700,
                border: '1px solid var(--warn-border)',
                marginRight: 2,
              }}
              title="Edits save as draft change requests for admin approval"
            >
              Propose Mode · Draft → Approval
            </span>
          ) : p.canEdit && p.role === 'manager' ? (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                background: 'var(--ok-bg)',
                color: 'var(--ok-fg)',
                fontSize: 11,
                fontWeight: 700,
                border: '1px solid var(--ok-border)',
                marginRight: 2,
              }}
              title="Admin edit window is active — changes save directly to the live schedule"
            >
              Direct Edit Mode · Live Window
            </span>
          ) : p.canEdit ? (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                background: 'var(--info-bg)',
                color: 'var(--info-fg)',
                fontSize: 11,
                fontWeight: 700,
                border: '1px solid var(--info-border)',
                marginRight: 2,
              }}
              title="Changes save directly to the live schedule"
            >
              Direct Edit Mode
            </span>
          ) : null}

          <span
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              background: 'var(--primary)',
              color: 'var(--primary-fg)',
              fontSize: 11.5,
              fontWeight: 700,
              marginRight: 4,
            }}
          >
            Brush: {p.brushLabel}
          </span>

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
            PW (default)
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
            {p.mode === 'paint'
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
