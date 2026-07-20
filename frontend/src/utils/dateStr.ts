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

/**
 * Safely formats a YYYY-MM-DD or ISO string to DD.MM.YYYY for UI display
 * without parsing into UTC Date (preventing off-by-one day shifts in western/eastern timezones).
 */
export function formatDateStr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const clean = String(iso).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-')
    return `${d}.${m}.${y}`
  }
  return new Date(iso).toLocaleDateString('uk-UA')
}

/**
 * Safely parses a YYYY-MM-DD string into a local Date object.
 */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

