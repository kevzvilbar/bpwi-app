'use client';

import dynamic from 'next/dynamic';
import { isMissingGensetsTableError } from '@/lib/gensets';
import PmDayInspector from '@/components/PmDayInspector';
import PmPlannerModals, {
  formatPmDayHeading as formatDayHeading,
  formatPmShortDay as formatShortDay,
  pmActivityColor as activityColor,
  PM_PRESETS as PRESETS,
} from '@/components/PmPlannerModals';
import {
  PM_MONTHS_FULL as MONTHS_FULL,
  PM_WEEKDAYS as WD,
  usePmPlannerState,
  type PmPlannerProps,
} from '@/components/usePmPlannerState';

const PmExportModal = dynamic(() => import('@/components/PmExportModal'), { ssr: false });
const PmCompleteModal = dynamic(() => import('@/components/PmCompleteModal'), { ssr: false });
const PmLocationsManagerModal = dynamic(() => import('@/components/PmLocationsManagerModal'), { ssr: false });
const PmGensetsModal = dynamic(() => import('@/components/PmGensetsModal'), { ssr: false });

export type { PmPlannerProps };

export default function PmPlanner(p: PmPlannerProps) {
  const pm = usePmPlannerState(p);
  const activeFilterCount = (pm.statusFilter ? 1 : 0) + (pm.areaFilter ? 1 : 0);
  const completionPct = pm.counts.total > 0 ? Math.round((pm.counts.done / pm.counts.total) * 100) : 0;
  const orderedChips = [...pm.activityChips].sort(
    (a, b) => Number(b.count > 0) - Number(a.count > 0),
  );

  return (
    <div className="card-pad w-full">
      {/* Top Toolbar */}
      <div className="no-print card card-pad-sm stack-sm pm-toolbar-compact" style={{ marginBottom: 8 }}>
        {/* Row 1: Date navigation + Primary CTA */}
        <div className="row-between-wrap">
          <div className="row-xs" style={{ flexWrap: 'wrap', gap: 5 }}>
            <button className="btn" onClick={() => pm.go(-1)} title="Previous" aria-label="Previous period">
              ‹
            </button>
            <input
              type="month"
              aria-label="Select month"
              value={p.month}
              onChange={(e) => pm.selectMonth(e.target.value)}
              className="input text-sm font-bold"
              style={{ width: 'auto', padding: '4px 8px' }}
            />
            <button className="btn" onClick={() => pm.go(1)} title="Next" aria-label="Next period">
              ›
            </button>
            <button className="btn" onClick={pm.goToday}>
              {pm.isPending ? 'Loading…' : 'Today'}
            </button>
            <h1 className="page-title desktop-only" style={{ fontSize: 16, margin: '0 4px' }}>
              {pm.monthLabel}
            </h1>
          </div>

          {p.canEdit && (
            <button className="btn btn-add" onClick={() => pm.openDraft(pm.blank(pm.selectedDate))}>
              + Schedule<span className="pm-label-desktop"> PM</span>
            </button>
          )}
        </div>

        {/* Row 2: View Toggle + Compact Actions / Filters */}
        <div className="row-between-wrap">
          <div className="segmented-tabs segmented-tabs-sm" role="tablist" aria-label="Calendar view">
            {(['month', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={pm.view === v}
                className="segmented-tab"
                onClick={() => pm.setView(v)}
              >
                {v === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>

          <div className="row-xs" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              className="btn mobile-only-block"
              onClick={() => pm.setFiltersOpen((o) => !o)}
              aria-expanded={pm.filtersOpen}
            >
              {pm.filtersOpen ? 'Hide Filters' : `Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
            </button>
            <div className={pm.filtersOpen ? 'row-wrap' : 'row-wrap desktop-only'}>
              <select className="btn" value={pm.statusFilter} onChange={(e) => pm.setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="planned">Planned</option>
                <option value="done">Done</option>
                <option value="postponed">Postponed</option>
              </select>
              <select className="btn" value={pm.areaFilter} onChange={(e) => pm.setAreaFilter(e.target.value)}>
                <option value="">All areas</option>
                {pm.allLocations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn" onClick={pm.exportIcs}>
                Export .ics
              </button>
              {p.canExportCsv && (
                <button
                  className="btn"
                  onClick={() => pm.setExportCsvOpen(true)}
                  title="Choose timeframe (Month, Quarter, Full Year, Custom) and export PM Schedule as CSV"
                >
                  Export CSV
                </button>
              )}
            </div>
            {p.canEdit && (
              <button
                className="btn"
                onClick={() => pm.setManageGensetsOpen(true)}
                title="Manage Genset Control #s and site assignments"
              >
                Gensets ({pm.gensets.length})
              </button>
            )}
            {p.canEdit && (
              <button className="btn" onClick={pm.openEditActivities} title="Edit activity names & colors">
                ✎<span className="pm-label-desktop"> Edit</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 3: Single-row Horizontal Category Chip Strip */}
        <div className="pm-chip-strip" role="group" aria-label="Activity type filters">
          <button
            type="button"
            className="pm-chip-pill"
            onClick={() => pm.setTypeFilter('')}
            style={{
              background: !pm.typeFilter ? 'var(--text)' : 'var(--surface-muted)',
              color: !pm.typeFilter ? 'var(--surface)' : 'var(--text)',
              border: '1px solid transparent',
            }}
          >
            <span>All</span>
            <span style={{ opacity: 0.78, fontSize: 10.5 }}>· {pm.counts.total}</span>
          </button>
          {orderedChips.map((c) => {
            const active = pm.typeFilter === c.type;
            return (
              <button
                key={c.type}
                type="button"
                onClick={() => pm.setTypeFilter(active ? '' : c.type)}
                className="pm-chip-pill"
                style={{
                  border: `1.5px solid ${active ? c.color : 'var(--border)'}`,
                  background: active ? c.color : 'var(--surface)',
                  color: active ? '#ffffff' : 'var(--text)',
                  opacity: pm.typeFilter && !active ? 0.55 : c.count === 0 && !active ? 0.72 : 1,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: active ? '#ffffff' : c.color,
                    flexShrink: 0,
                  }}
                />
                <span>{c.short}</span>
                <span style={{ fontSize: 10.5, opacity: active ? 0.9 : 0.65 }}>{c.count}</span>
              </button>
            );
          })}
        </div>

        {/* Row 4: Completion Progress & Summary Strip */}
        <div className="stack-xs">
          <div className="pm-progress-track" aria-hidden="true">
            <div className="pm-progress-fill" style={{ width: `${completionPct}%` }} />
          </div>
          <div className="row-between-wrap text-secondary-xs">
            <div className="row-wrap" style={{ gap: 10 }}>
              <span>
                <strong style={{ color: 'var(--ok-fg)' }}>●</strong> <b>{pm.counts.done}/{pm.counts.total}</b> done
              </span>
              <span>
                <strong style={{ color: 'var(--primary)' }}>●</strong> <b>{pm.counts.planned}</b> planned
              </span>
            </div>
            {pm.nextTask && (
              <span className="truncate" style={{ maxWidth: '100%' }}>
                <strong style={{ color: 'var(--accent)' }}>Next:</strong> <b>{formatShortDay(pm.nextTask.scheduled_date)}</b>{' '}
                {PRESETS[pm.nextTask.activity_type]?.short ?? pm.nextTask.title}
                {pm.nextTask.locations.length ? ` · ${pm.nextTask.locations[0]}` : ''}
              </span>
            )}
          </div>
          {pm.msg && (
            <div role="alert" className="text-danger-sm font-bold">
              {pm.msg}
            </div>
          )}
        </div>
      </div>

      {/* Main Split: Calendar Grid + Day Inspector Sidebar */}
      <div className="pm-layout">
        {/* Calendar Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 1,
            background: 'var(--border)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {WD.map((d) => (
            <div
              key={d}
              className="section-eyebrow text-center"
              style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)', padding: '6px 4px' }}
            >
              {d}
            </div>
          ))}

          {pm.gridDays.map((d) => {
            const inMonth = d.startsWith(p.month);
            const isToday = d === p.today;
            const isSelected = d === pm.selectedDate;
            const dayNum = +d.slice(8);
            const list = pm.byDate.get(d) ?? [];
            const hol = pm.holidayByDate.get(d);

            return (
              <div
                key={d}
                className="pm-day-cell"
                role="button"
                tabIndex={0}
                aria-label={`${d}${hol ? `, Holiday: ${hol.name}` : ''}, ${list.length} PM ${list.length === 1 ? 'task' : 'tasks'}${isToday ? ', Today' : ''}`}
                aria-pressed={isSelected}
                onClick={() => pm.setSelectedDate(d)}
                onDoubleClick={() => p.canEdit && pm.setDraft(pm.blank(d))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pm.setSelectedDate(d);
                  } else if (e.key.toLowerCase() === 'n' && p.canEdit) {
                    e.preventDefault();
                    pm.setDraft(pm.blank(d));
                  }
                }}
                onDragOver={(e) => {
                  if (p.canEdit) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!p.canEdit) return;
                  const taskId = e.dataTransfer.getData('text/plain');
                  if (taskId) void pm.rescheduleTask(taskId, d);
                }}
                style={{
                  background: isToday
                    ? 'var(--surface-muted)'
                    : hol
                      ? 'rgba(225, 29, 72, 0.06)'
                      : inMonth
                        ? 'var(--surface)'
                        : 'var(--bg)',
                  minHeight: pm.view === 'week' ? 320 : undefined,
                  padding: 4,
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid var(--teal)' : 'none',
                  outlineOffset: -2,
                  opacity: inMonth ? 1 : 0.65,
                }}
              >
                <div className="text-center" style={{ marginBottom: 4 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 22,
                      height: 22,
                      padding: dayNum === 1 ? '0 6px' : '0 4px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: isToday ? '#0369a1' : hol ? 'var(--danger-bg)' : 'transparent',
                      color: isToday ? '#ffffff' : hol ? 'var(--danger-fg)' : inMonth ? 'var(--text)' : 'var(--text-muted)',
                    }}
                    title={hol ? hol.name : undefined}
                  >
                    {dayNum === 1 ? `${MONTHS_FULL[+d.slice(5, 7) - 1].slice(0, 3)} 1` : dayNum}
                  </span>
                </div>

                {hol && (
                  <div
                    className="pm-desktop-pill badge-danger truncate text-center"
                    title={`${hol.name} (${hol.holiday_type.replace(/_/g, ' ')})`}
                    style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', marginBottom: 3 }}
                  >
                    ★ {hol.name}
                  </div>
                )}

                {/* Mobile compact dots (<= 640px) */}
                {list.length > 0 && (
                  <div className="pm-mobile-dots" aria-hidden="true">
                    {list.map((t) => {
                      const meta = pm.activityMeta.get(t.activity_type);
                      const color = meta?.color ?? activityColor(t.activity_type, t.title);
                      return (
                        <span
                          key={t.id}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: t.status === 'done' ? 'transparent' : color,
                            border: `2px solid ${color}`,
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                {list.map((t) => {
                  const meta = pm.activityMeta.get(t.activity_type);
                  const color = meta?.color ?? activityColor(t.activity_type, t.title);
                  const isDone = t.status === 'done';
                  const conflict = pm.hasConflict(t);
                  const shortTitle = meta?.short ?? t.title;
                  const fullTitle = meta?.label ?? t.title;
                  const chipText = t.locations.length ? `${shortTitle} - ${t.locations[0]}` : shortTitle;

                  return (
                    <div
                      key={t.id}
                      className="pm-desktop-pill row-xs"
                      draggable={p.canEdit}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        pm.setSelectedDate(d);
                        if (p.canEdit) pm.setDraft(pm.edit(t));
                      }}
                      title={`${fullTitle}\n${t.locations.join(', ')}${t.asset ? '\n' + t.asset : ''}\n${t.assigned_operator_ids
                        .map((id) => pm.opBy.get(id)?.full_name)
                        .filter(Boolean)
                        .join(', ')}${conflict ? '\n⚠ Crew conflict (RD/off/leave)' : ''}`}
                      style={{
                        background: isDone ? 'var(--surface)' : color,
                        color: isDone ? color : '#ffffff',
                        border: `1.5px solid ${color}`,
                        borderRadius: 999,
                        padding: '2px 6px',
                        margin: '2px 0',
                        fontSize: 10.5,
                        fontWeight: 700,
                        lineHeight: 1.25,
                        cursor: 'pointer',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!p.canEdit) return;
                          if (isDone) void pm.updateTask(t, { status: 'planned' });
                          else pm.setCompleteModal({ task: t, mode: 'complete' });
                        }}
                        title={isDone ? 'Mark as planned' : 'Mark as done'}
                        style={{
                          width: 13,
                          height: 13,
                          minWidth: 13,
                          borderRadius: '50%',
                          border: `1.5px solid ${isDone ? color : '#ffffff'}`,
                          background: isDone ? color : 'transparent',
                          color: '#ffffff',
                          fontSize: 8.5,
                          lineHeight: 1,
                          padding: 0,
                          display: 'grid',
                          placeItems: 'center',
                          cursor: p.canEdit ? 'pointer' : 'default',
                        }}
                      >
                        {isDone ? '✓' : ''}
                      </button>
                      <span
                        className="flex-1 truncate"
                        style={isDone ? { textDecoration: 'line-through', opacity: 0.85 } : undefined}
                      >
                        {chipText}
                      </span>
                      {conflict && (
                        <span
                          title="Crew conflict"
                          className="font-bold"
                          style={{ background: '#f59e0b', color: '#451a03', borderRadius: 3, padding: '0 4px', fontSize: 9.5 }}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="pm-calendar-legend">
            <span>
              <strong style={{ color: 'var(--primary)' }}>●</strong> Planned
            </span>
            <span>
              <strong style={{ color: 'var(--teal)' }}>○</strong> Completed
            </span>
            <span>
              <strong style={{ color: 'var(--danger-fg)' }}>●</strong> Holiday
            </span>
          </div>
        </div>

        {/* Right-Hand Day Inspector Sidebar */}
        <PmDayInspector
          selectedDate={pm.selectedDate}
          heading={formatDayHeading(pm.selectedDate)}
          dayRel={pm.dayRel}
          holiday={pm.holidayByDate.get(pm.selectedDate)}
          onDuty={pm.onDuty}
          onRest={pm.onRest}
          onLeave={pm.onLeave}
          dayStandby={pm.dayStandby}
          dayTasks={pm.dayTasks}
          operators={p.operators}
          opBy={pm.opBy}
          activityMeta={pm.activityMeta}
          fallbackColor={activityColor}
          getOperatorConflict={pm.getOperatorConflict}
          canEdit={p.canEdit}
          onUpdateTask={(t, patch) => void pm.updateTask(t, patch)}
          onRequestComplete={(t, mode) => pm.setCompleteModal({ task: t, mode })}
          onEditTask={(t) => pm.openDraft(pm.edit(t))}
          onRemoveTask={(target) => pm.remove('one', target)}
          onCreateNewTask={() => pm.openDraft(pm.blank(pm.selectedDate))}
        />
      </div>

      <PmPlannerModals
        canEdit={p.canEdit}
        draft={pm.draft}
        setDraft={pm.setDraft}
        busy={pm.busy}
        onSave={() => void pm.save()}
        onRequestRemove={pm.remove}
        confirmDel={pm.confirmDel}
        onCancelDelete={() => pm.setConfirmDel(null)}
        onExecuteDelete={() => void pm.executeRemove()}
        editActsOpen={pm.editActsOpen}
        setEditActsOpen={pm.setEditActsOpen}
        actDraft={pm.actDraft}
        setActDraft={pm.setActDraft}
        savingActs={pm.savingActs}
        onSaveActivities={() => void pm.saveActivities()}
        activityChips={pm.activityChips}
        operators={p.operators}
        holidayByDate={pm.holidayByDate}
        getOperatorConflict={pm.getOperatorConflict}
        savedLocationCatalog={pm.savedLocationCatalog}
        onOpenManageLocations={() => pm.setManageLocsOpen(true)}
        gensets={pm.gensets}
        onOpenManageGensets={() => pm.setManageGensetsOpen(true)}
        modalError={pm.msg}
      />

      {pm.manageLocsOpen && (
        <PmLocationsManagerModal
          open
          orgId={p.orgId}
          canEdit={p.canEdit}
          tableReady={p.pmLocationsTableReady ?? true}
          pmLocations={pm.pmLocations}
          setPmLocations={pm.setPmLocations}
          areas={p.areas}
          onClose={() => pm.setManageLocsOpen(false)}
        />
      )}

      {pm.manageGensetsOpen && (
        <PmGensetsModal
          open
          orgId={p.orgId}
          canEdit={p.canEdit}
          tableReady={p.gensetsTableReady ?? !isMissingGensetsTableError(null)}
          gensets={pm.gensets}
          setGensets={pm.setGensets}
          savedLocations={pm.savedLocationCatalog}
          onClose={() => pm.setManageGensetsOpen(false)}
        />
      )}

      {pm.exportCsvOpen && p.canExportCsv && (
        <PmExportModal
          currentMonth={p.month}
          typeFilter={pm.typeFilter}
          statusFilter={pm.statusFilter}
          areaFilter={pm.areaFilter}
          onClose={() => pm.setExportCsvOpen(false)}
        />
      )}

      {pm.completeModal && (
        <PmCompleteModal
          open
          mode={pm.completeModal.mode}
          task={pm.completeModal.task}
          operators={p.operators}
          currentOperatorId={p.operatorId}
          busy={pm.completeBusy}
          onCancel={() => pm.setCompleteModal(null)}
          onConfirm={(payload) => pm.confirmComplete(payload)}
        />
      )}
    </div>
  );
}
