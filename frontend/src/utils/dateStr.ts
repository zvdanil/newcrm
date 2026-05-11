/**
 * Returns a YYYY-MM-DD string in LOCAL time (not UTC).
 * Using toISOString().slice(0,10) on a local-time Date gives the UTC date,
 * which is wrong in UTC+ timezones (shifts the date back by one day).
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Returns today's date as YYYY-MM-DD in local time. */
export function today(): string {
  return localDateStr(new Date())
}

/** Returns the first day of the current month as YYYY-MM-DD in local time. */
export function firstOfMonth(d: Date = new Date()): string {
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** Returns YYYY-MM string in LOCAL time. */
export function localMonthStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Shifts a YYYY-MM string by ±1 month using pure arithmetic (no Date object). */
export function shiftMonth(ym: string, delta: 1 | -1): string {
  const [y, m] = ym.split('-').map(Number)
  let nm = m + delta
  let ny = y
  if (nm < 1)  { nm = 12; ny -= 1 }
  if (nm > 12) { nm = 1;  ny += 1 }
  return `${ny}-${String(nm).padStart(2, '0')}`
}
