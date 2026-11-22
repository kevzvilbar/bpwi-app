export const SETUP_CELL_STYLE = { padding: 4, borderBottom: '1px solid var(--border-light)' };

export const SETUP_INPUT_STYLE = {
  width: '100%',
  padding: '5px 7px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 12.5,
  background: 'var(--surface)',
  color: 'var(--text)',
} as const;

export function getSetupSaveLabel(key: string, busy: string, savedKey: string, dirty: Set<string>) {
  return savedKey === key ? 'Saved ✓' : busy === key ? '…' : dirty.has(key) ? 'Save *' : 'Save';
}
