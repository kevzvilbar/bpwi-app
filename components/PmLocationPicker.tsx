'use client';

import { useMemo, useRef, useState } from 'react';
import {
  filterLocationSuggestions,
  normalizeLocationKey,
  resolveSavedLocation,
  type PmLocationOption,
} from '@/lib/pm-locations';

interface PmLocationPickerProps {
  selected: string[];
  query: string;
  catalog: PmLocationOption[];
  splitLocations: boolean;
  showSplitOption: boolean;
  canManage: boolean;
  legacyExisting?: string[];
  onChangeSelected: (next: string[]) => void;
  onChangeQuery: (next: string) => void;
  onChangeSplit: (next: boolean) => void;
  onOpenManage: () => void;
}

export default function PmLocationPicker({
  selected,
  query,
  catalog,
  splitLocations,
  showSplitOption,
  canManage,
  legacyExisting = [],
  onChangeSelected,
  onChangeQuery,
  onChangeSplit,
  onOpenManage,
}: PmLocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [rejectedMsg, setRejectedMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => filterLocationSuggestions(catalog, query, selected, 12),
    [catalog, query, selected],
  );

  const catalogKeys = useMemo(
    () => new Set(catalog.map((c) => normalizeLocationKey(c.name))),
    [catalog],
  );
  const legacyKeys = useMemo(
    () => new Set(legacyExisting.map(normalizeLocationKey)),
    [legacyExisting],
  );

  const trimmedQuery = query.trim().replace(/\s+/g, ' ');
  const exactMatch = resolveSavedLocation(catalog, trimmedQuery);
  const noMatchWhileTyping = trimmedQuery.length > 0 && suggestions.length === 0 && !exactMatch;

  const pickOption = (canonicalName: string) => {
    const key = normalizeLocationKey(canonicalName);
    if (!selected.some((s) => normalizeLocationKey(s) === key)) {
      onChangeSelected([...selected, canonicalName]);
    }
    onChangeQuery('');
    setRejectedMsg('');
    setHighlightIdx(0);
    setOpen(false);
  };

  const removeLocation = (nameToRemove: string) => {
    const targetKey = normalizeLocationKey(nameToRemove);
    onChangeSelected(selected.filter((s) => normalizeLocationKey(s) !== targetKey));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx((i) => (suggestions.length > 0 ? (i + 1) % suggestions.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx((i) => (suggestions.length > 0 ? (i - 1 + suggestions.length) % suggestions.length : 0));
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      e.preventDefault();
      onChangeSelected(selected.slice(0, -1));
      return;
    }
    if (e.key === 'Enter') {
      if (!trimmedQuery && !open) return;
      e.preventDefault();
      if (exactMatch) {
        pickOption(exactMatch.name);
        return;
      }
      if (open && suggestions.length > 0 && trimmedQuery.length > 0) {
        const picked = suggestions[Math.min(highlightIdx, suggestions.length - 1)];
        if (picked) {
          pickOption(picked.name);
          return;
        }
      }
      if (trimmedQuery) {
        setRejectedMsg(`"${trimmedQuery}" is not in the saved areas/sites list.`);
      }
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <label htmlFor="pm-loc-combobox" style={{ fontSize: 13 }}>
          Locations / areas{' '}
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 400 }}>
            (saved list only)
          </span>
        </label>
        {canManage && (
          <button
            type="button"
            onClick={onOpenManage}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--teal)',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Manage list
          </button>
        )}
      </div>

      {/* Selected location chips */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {selected.map((loc) => {
            const k = normalizeLocationKey(loc);
            const isLegacyOnly = !catalogKeys.has(k) && legacyKeys.has(k);
            return (
              <span
                key={loc}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background: isLegacyOnly ? 'var(--warn-bg)' : 'var(--info-bg)',
                  color: isLegacyOnly ? 'var(--warn-fg)' : 'var(--info-fg)',
                  border: isLegacyOnly ? '1px solid var(--warn-border)' : '1px solid var(--info-border)',
                }}
              >
                <span>
                  {loc}
                  {isLegacyOnly ? ' (legacy)' : ''}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${loc}`}
                  onClick={() => removeLocation(loc)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Searchable autocomplete input + floating suggestion list */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          id="pm-loc-combobox"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="pm-loc-suggestions"
          className="input"
          value={query}
          placeholder={
            catalog.length > 0
              ? 'Search & select saved area / site…'
              : 'No saved locations yet — add via Manage list or Settings'
          }
          onFocus={() => {
            setHighlightIdx(0);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            onChangeQuery(e.target.value);
            setHighlightIdx(0);
            setRejectedMsg('');
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />

        {open && suggestions.length > 0 && (
          <div
            id="pm-loc-suggestions"
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 30,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-md)',
              maxHeight: 196,
              overflowY: 'auto',
              padding: 4,
              display: 'grid',
              gap: 2,
            }}
          >
            {suggestions.map((opt, idx) => {
              const active = idx === highlightIdx;
              return (
                <button
                  key={opt.name}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickOption(opt.name);
                    inputRef.current?.focus();
                  }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 9px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'var(--surface-hover)' : 'transparent',
                    color: 'var(--text)',
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <span>{opt.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {opt.stationCode ? `${opt.stationCode} sub-site` : 'Saved'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(rejectedMsg || noMatchWhileTyping) && (
        <div style={{ fontSize: 11.5, color: 'var(--danger)', fontWeight: 600 }}>
          {rejectedMsg || `No saved area/site matches "${trimmedQuery}". Pick a saved suggestion or add it in Manage list / Settings first.`}
        </div>
      )}

      {showSplitOption && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="checkbox"
            checked={splitLocations}
            onChange={(e) => onChangeSplit(e.target.checked)}
          />
          <span>Create one task per location (track each one&apos;s status separately)</span>
          {splitLocations && selected.length > 1 && (
            <span
              style={{
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background: 'var(--info-bg)',
                color: 'var(--info-fg)',
                border: '1px solid var(--info-border)',
              }}
            >
              → {selected.length} separate tasks per date
            </span>
          )}
          {splitLocations && selected.length <= 1 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(pick 2+ locations above)</span>
          )}
        </label>
      )}
    </div>
  );
}
