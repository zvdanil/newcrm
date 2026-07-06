import { sql, RawBuilder } from 'kysely'

/**
 * Safely converts a Date or Date-string into a 'YYYY-MM-DD' formatted string
 * without causing timezone offsets/shifts.
 */
export function toDbDateStr(date: Date | string): string {
  if (typeof date === 'string') {
    return date.slice(0, 10)
  }
  
  // Database DATE fields are parsed as UTC midnight (00:00:00.000Z).
  // Using UTC methods ensures timezone safety.
  // For local timestamps (e.g. new Date()), local getters represent local "today".
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    const d = String(date.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  } else {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

/**
 * Creates a Kysely raw builder to cast a date safely as a PostgreSQL DATE type.
 */
export function castAsDate(date: Date | string): RawBuilder<Date> {
  return sql<Date>`CAST(${toDbDateStr(date)} AS DATE)`
}
