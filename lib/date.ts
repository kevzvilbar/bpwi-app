export function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function manilaYear() {
  return Number(manilaToday().slice(0, 4));
}
