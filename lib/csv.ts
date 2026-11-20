/**
 * Neutralizes CSV / spreadsheet formula injection (OWASP CSV Injection).
 * Any cell beginning with =, +, -, @ (even after leading spaces) or tab/CR
 * is prefixed with a single quote so Excel / LibreOffice / Sheets treat it as literal text.
 */
const FORMULA_PREFIX_RE = /^(?:[ ]*[=+\-@]|[\t\r])/;

export function neutralizeCsvFormula(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  if (!str) return '';
  return FORMULA_PREFIX_RE.test(str) ? `'${str}` : str;
}

/**
 * Minimal CSV cell escaping: neutralizes formula prefixes and wraps in double quotes
 * only when the value contains commas, quotes, or line breaks.
 */
export function csvEscape(value: string | number | null | undefined): string {
  const safe = neutralizeCsvFormula(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Always-quoted CSV cell escaping (used by server CSV download endpoints):
 * neutralizes formula prefixes and wraps every cell in double quotes.
 */
export function csvQuote(value: string | number | null | undefined): string {
  const safe = neutralizeCsvFormula(value);
  return `"${safe.replace(/"/g, '""')}"`;
}
