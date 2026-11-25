'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildPasteShiftEntries,
  cellKey,
  extractCopiedBlock,
  normalizeShiftForArea,
  type Area,
  type CopiedScheduleBlock,
  type GridRect,
  type HistoryEntry,
  type Op,
  type RosterDay,
  type Row,
  type Shift,
  type ShiftHistoryItem,
  type ToolMode,
} from '@/lib/roster-helpers';

interface UseRosterClipboardParams {
  canOperate: boolean;
  filteredOperators: Op[];
  days: RosterDay[];
  cell: ReadonlyMap<string, Row>;
  shiftBy: ReadonlyMap<string, Shift>;
  areaBy: ReadonlyMap<string, Area>;
  offShift?: Shift;
  setMode: Dispatch<SetStateAction<ToolMode>>;
  setMsg: Dispatch<SetStateAction<string>>;
  setRows: Dispatch<SetStateAction<Row[]>>;
  setUndoStack: Dispatch<SetStateAction<HistoryEntry[]>>;
  setRedoStack: Dispatch<SetStateAction<HistoryEntry[]>>;
  persistShiftEntries: (entries: ShiftHistoryItem[]) => Promise<void>;
  saveShiftCell: (opId: string, date: string, nextRow: Row | null, prevCell: Row | null) => Promise<void>;
  clearCell: (opId: string, date: string) => Promise<void>;
}

/** Manages roster cell/block selection, copy/paste clipboard state, and multi-cell batch paste. */
export function useRosterClipboard(p: UseRosterClipboardParams) {
  const [clipboard, setClipboard] = useState<{ shift_type_id: string | null; area_code_id: string | null } | null>(null);
  const [copyStep, setCopyStep] = useState<'select' | 'paste'>('select');
  const [copiedBlock, setCopiedBlock] = useState<CopiedScheduleBlock | null>(null);
  const [copySelection, setCopySelection] = useState<GridRect | null>(null);
  const copySelectionRef = useRef<GridRect | null>(null);

  function enterCopyMode(forceSelect = false) {
    copySelectionRef.current = null;
    setCopySelection(null);
    p.setMode('copy');
    setCopyStep(forceSelect || !copiedBlock ? 'select' : 'paste');
  }

  function resetCopySource() {
    copySelectionRef.current = null;
    setCopySelection(null);
    setCopiedBlock(null);
    setCopyStep('select');
  }

  function handleCopyEscape(): boolean {
    if (copySelectionRef.current) {
      copySelectionRef.current = null;
      setCopySelection(null);
      return true;
    }
    if (copiedBlock) {
      resetCopySource();
      return true;
    }
    p.setMode('paint');
    return true;
  }

  function startCopySelection(rIdx: number, cIdx: number) {
    const rect: GridRect = { startR: rIdx, startC: cIdx, endR: rIdx, endC: cIdx };
    copySelectionRef.current = rect;
    setCopySelection(rect);
  }

  function updateCopySelection(rIdx: number, cIdx: number) {
    if (!copySelectionRef.current) return;
    const next: GridRect = { ...copySelectionRef.current, endR: rIdx, endC: cIdx };
    copySelectionRef.current = next;
    setCopySelection(next);
  }

  function commitCopySelection() {
    const rect = copySelectionRef.current;
    copySelectionRef.current = null;
    setCopySelection(null);
    if (!rect) return;
    const block = extractCopiedBlock({
      rect, operators: p.filteredOperators, days: p.days, cell: p.cell, shiftBy: p.shiftBy, areaBy: p.areaBy,
    });
    if (!block) return;
    setCopiedBlock(block);
    setCopyStep('paste');
    if (block.rows === 1 && block.cols === 1) {
      setClipboard({ shift_type_id: block.cells[0].shift_type_id, area_code_id: block.cells[0].area_code_id });
    }
  }

  async function pasteCopiedBlockAt(originR: number, originC: number) {
    if (!p.canOperate || !copiedBlock) return;
    p.setMsg('');
    const { entries, nextRows } = buildPasteShiftEntries({
      block: copiedBlock,
      originR,
      originC,
      operators: p.filteredOperators,
      days: p.days,
      cell: p.cell,
      areaBy: p.areaBy,
      offShift: p.offShift,
    });
    if (entries.length === 0) return;
    const restored = Array.from(nextRows.values()).filter((x): x is Row => Boolean(x));
    p.setRows((r) => [...r.filter((x) => !nextRows.has(cellKey(x.operator_id, x.schedule_date))), ...restored]);
    p.setUndoStack((s) => [...s.slice(-29), entries]);
    p.setRedoStack([]);
    await p.persistShiftEntries(entries);
  }

  async function activateCopyCell(opId: string, date: string) {
    const rIdx = p.filteredOperators.findIndex((o) => o.id === opId);
    const cIdx = p.days.findIndex((d) => d.date === date);
    if (rIdx < 0 || cIdx < 0) return;
    if (copyStep === 'select' || !copiedBlock) {
      const block = extractCopiedBlock({
        rect: { startR: rIdx, startC: cIdx, endR: rIdx, endC: cIdx },
        operators: p.filteredOperators, days: p.days, cell: p.cell, shiftBy: p.shiftBy, areaBy: p.areaBy,
      });
      if (!block) return;
      setCopiedBlock(block);
      setCopyStep('paste');
      setClipboard({ shift_type_id: block.cells[0].shift_type_id, area_code_id: block.cells[0].area_code_id });
    } else {
      await pasteCopiedBlockAt(rIdx, cIdx);
    }
  }

  function copyCell(opId: string, date: string) {
    const existing = p.cell.get(cellKey(opId, date));
    setClipboard(
      existing ? { shift_type_id: existing.shift_type_id, area_code_id: existing.area_code_id } : { shift_type_id: null, area_code_id: null },
    );
    const rIdx = p.filteredOperators.findIndex((o) => o.id === opId);
    const cIdx = p.days.findIndex((d) => d.date === date);
    if (rIdx >= 0 && cIdx >= 0) {
      const block = extractCopiedBlock({
        rect: { startR: rIdx, startC: cIdx, endR: rIdx, endC: cIdx },
        operators: p.filteredOperators, days: p.days, cell: p.cell, shiftBy: p.shiftBy, areaBy: p.areaBy,
      });
      if (block) setCopiedBlock(block);
    }
  }

  function pasteCell(opId: string, date: string) {
    if (!p.canOperate) return;
    const rIdx = p.filteredOperators.findIndex((o) => o.id === opId);
    const cIdx = p.days.findIndex((d) => d.date === date);
    if (copiedBlock && rIdx >= 0 && cIdx >= 0) {
      void pasteCopiedBlockAt(rIdx, cIdx);
      return;
    }
    if (!clipboard) return;
    const effShiftId = normalizeShiftForArea(clipboard.shift_type_id, clipboard.area_code_id, p.areaBy, p.offShift);
    if (!effShiftId && !clipboard.area_code_id) { void p.clearCell(opId, date); return; }
    const prevCell = p.cell.get(cellKey(opId, date)) ?? null;
    void p.saveShiftCell(opId, date, { operator_id: opId, schedule_date: date, shift_type_id: effShiftId, area_code_id: clipboard.area_code_id }, prevCell);
  }

  return {
    copyStep,
    copiedBlock,
    copySelection,
    hasActiveCopyDrag: () => Boolean(copySelectionRef.current),
    enterCopyMode,
    resetCopySource,
    startCopySelection,
    updateCopySelection,
    commitCopySelection,
    pasteCopiedBlockAt,
    activateCopyCell,
    copyCell,
    pasteCell,
    handleCopyEscape,
  };
}
