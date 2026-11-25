'use client';

import RosterMobileViews from '@/components/RosterMobileViews';
import RosterToolbar from '@/components/RosterToolbar';
import RosterGrid from '@/components/RosterGrid';
import {
  RosterContextMenu,
  RosterFillConfirmModal,
  RosterImportJsonModal,
  RosterProposeBar,
  RosterSubmitProposalModal,
} from '@/components/RosterModals';
import { useRosterActions, type RosterProps } from '@/components/useRosterActions';

export type { RosterProps };

export default function Roster(p: RosterProps) {
  const r = useRosterActions(p);

  return (
    <div className="card-pad w-full">
      <RosterToolbar
        month={p.month}
        today={p.today}
        orgId={p.orgId}
        role={p.role}
        canEdit={r.hasActiveEdit}
        canOperate={r.canOperate}
        isPropose={r.isPropose}
        hasLinkedOp={r.hasLinkedOp}
        onlyMe={r.onlyMe}
        onToggleOnlyMe={() => r.setOnlyMe((v) => !v)}
        search={r.search}
        onSearchChange={r.setSearch}
        isPending={r.isPending}
        onGoMonth={r.go}
        onSelectMonth={r.selectMonth}
        onGoToday={r.goToday}
        todayCoverage={r.todayCoverage}
        saveState={r.saveState}
        msg={r.msg}
        mobileToolsOpen={r.mobileToolsOpen}
        onToggleMobileTools={() => r.setMobileToolsOpen((o) => !o)}
        brushLabel={r.brushLabel}
        onExportCsv={r.exportCsv}
        onPrint={() => window.print()}
        onOpenImport={() => {
          r.setImportStatus('');
          r.setImportOpen(true);
        }}
        showHint={r.showHint}
        onDismissHint={() => {
          localStorage.setItem('bpwi-roster-hint-dismissed', '1');
          r.setShowHint(false);
        }}
        shifts={p.shifts}
        areas={p.areas}
        mode={r.mode}
        setMode={r.setMode}
        copyStep={r.copyStep}
        copiedBlock={r.copiedBlock}
        onToggleCopyMode={() => r.enterCopyMode()}
        onResetCopySource={r.resetCopySource}
        shiftId={r.shiftId}
        setShiftId={r.handleSelectShift}
        areaId={r.areaId}
        setAreaId={r.handleSelectArea}
        standbyType={r.standbyType}
        setStandbyType={r.setStandbyType}
        canUndo={r.canUndo}
        canRedo={r.canRedo}
        onUndo={r.handleUndo}
        onRedo={r.handleRedo}
        draftItems={r.draftItems}
        onDiscardDrafts={() => void r.discardDraftBatch()}
      />

      <RosterMobileViews
        month={p.month}
        today={p.today}
        days={r.days}
        operators={r.filteredOperators}
        operatorId={p.operatorId}
        cell={r.cell}
        standbyMap={r.standbyMap}
        shiftBy={r.shiftBy}
        areaBy={r.areaBy}
        canEdit={r.canOperate}
        onCellTap={(opId, date) => void r.activateCell(opId, date)}
        onCellMenu={(op, date, coords) =>
          r.setCtxMenu({
            x: coords?.clientX ?? 16,
            y: coords?.clientY ?? 200,
            opId: op.id,
            opName: op.full_name,
            date,
          })
        }
      />

      <RosterGrid
        monthLabel={r.monthLabel}
        today={p.today}
        days={r.days}
        operators={r.filteredOperators}
        totalOperatorsCount={p.operators.length}
        operatorId={p.operatorId}
        canEdit={r.hasActiveEdit}
        canOperate={r.canOperate}
        mode={r.mode}
        copyStep={r.copyStep}
        copiedBlock={r.copiedBlock}
        copySelection={r.copySelection}
        cell={r.cell}
        pendingMap={r.pendingMap}
        standbyMap={r.standbyMap}
        shiftBy={r.shiftBy}
        areaBy={r.areaBy}
        pmByCell={r.pmByCell}
        holidayByDate={r.holidayByDate}
        dailyWorkingCounts={r.dailyWorkingCounts}
        dragRef={r.dragRef}
        onApplyBrushLocal={r.applyBrushLocal}
        onActivateCell={(opId, date) => void r.activateCell(opId, date)}
        onStartCopySelection={r.startCopySelection}
        onUpdateCopySelection={r.updateCopySelection}
        onPasteBlockAt={(opIdIdx, dateIdx) => void r.pasteCopiedBlockAt(opIdIdx, dateIdx)}
        onClearCell={(opId, date) => void r.clearCell(opId, date)}
        onCopyCell={r.copyCell}
        onPasteCell={r.pasteCell}
        onOpenContextMenu={r.setCtxMenu}
      />

      {r.ctxMenu && (
        <RosterContextMenu
          ctxMenu={r.ctxMenu}
          onClose={() => r.setCtxMenu(null)}
          onSetStandby={r.setStandbyValue}
          onRequestFillRight={(opId, opName, date) => {
            const count = r.days.filter((d) => d.date >= date).length;
            r.setConfirmFill({ opId, opName, date, count });
          }}
          onClearCell={r.clearCell}
        />
      )}

      {r.confirmFill && (
        <RosterFillConfirmModal
          confirmFill={r.confirmFill}
          monthLabel={r.monthLabel}
          onCancel={() => r.setConfirmFill(null)}
          onConfirm={() => {
            const target = r.confirmFill;
            r.setConfirmFill(null);
            if (target) void r.fillRight(target.opId, target.date);
          }}
        />
      )}

      {r.importOpen && (
        <RosterImportJsonModal
          importing={r.importing}
          importStatus={r.importStatus}
          onFileChange={r.handleImportFile}
          onClose={() => r.setImportOpen(false)}
        />
      )}

      {r.draftItems.length > 0 && (r.isPropose || r.proposedDraftItems.length > 0) && (
        <RosterProposeBar
          count={r.draftItems.length}
          onOpenSubmit={() => r.setSubmitModalOpen(true)}
          onDiscard={() => void r.discardDraftBatch()}
        />
      )}

      {r.submitModalOpen && (
        <RosterSubmitProposalModal
          count={r.draftItems.length}
          submitNote={r.submitNote}
          isSubmitting={r.isSubmittingDraft}
          onChangeNote={r.setSubmitNote}
          onCancel={() => r.setSubmitModalOpen(false)}
          onSubmit={() => void r.submitDraftBatch()}
        />
      )}
    </div>
  );
}
