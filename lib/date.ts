export function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function manilaYear() {
  return Number(manilaToday().slice(0, 4));
}

export function manilaNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

// Manila has no daylight saving, so a fixed +08:00 offset is exact.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "Thu, 20 Nov, 5:00 PM" in Manila time. */
export function formatManila(iso: string) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "20 Nov 2026" for a plain YYYY-MM-DD date. */
export function formatDateOnly(ymd: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(ymd + 'T00:00:00Z'),
  );
}

/** Value for <input type="datetime-local"> showing `date` in Manila time. */
export function toManilaInput(date: Date) {
  return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Convert a <input type="datetime-local"> value, read as Manila time, to an ISO instant. */
export function manilaInputToIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}
