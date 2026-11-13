import { eachDayOfInterval, format, isValid, parse } from 'date-fns'

/**
 * Local calendar day in `yyyy-MM-dd` form.
 *
 * IndexedDB keys cannot be `Date`-safe across timezones, so every record is
 * tagged with a `DateKey` derived from the **local** calendar day of its
 * timestamp. That keeps "blocks of this day" queries timezone-stable.
 */
export type DateKey = string

export type DateInput = Date | string | number

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value)
}

/** Normalises any accepted date input into a `Date` (local time for keys). */
export function toDate(value: DateInput): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (isDateKey(value)) return parse(value, 'yyyy-MM-dd', new Date())
  return new Date(value)
}

/** `yyyy-MM-dd` for the local calendar day of `value`. */
export function toDateKey(value: DateInput): DateKey {
  const date = toDate(value)
  if (!isValid(date)) {
    throw new RangeError(`Invalid date value: ${String(value)}`)
  }
  return format(date, 'yyyy-MM-dd')
}

/** Local midnight of a `yyyy-MM-dd` key. */
export function fromDateKey(key: DateKey): Date {
  if (!isDateKey(key)) {
    throw new RangeError(`Invalid date key: ${key}`)
  }
  return parse(key, 'yyyy-MM-dd', new Date())
}

/** Today's local calendar day. */
export function todayKey(now: DateInput = new Date()): DateKey {
  return toDateKey(now)
}

/** Inclusive list of day keys between two dates (used for range queries). */
export function listDateKeys(from: DateInput, to: DateInput): DateKey[] {
  const start = toDate(from)
  const end = toDate(to)
  if (!isValid(start) || !isValid(end)) {
    throw new RangeError('Invalid date range')
  }
  if (start > end) return []
  return eachDayOfInterval({ start, end }).map((day) => toDateKey(day))
}

/** ISO 8601 string for a timestamp-ish input, validated. */
export function toIsoString(value: DateInput): string {
  const date = toDate(value)
  if (!isValid(date)) {
    throw new RangeError(`Invalid timestamp: ${String(value)}`)
  }
  return date.toISOString()
}
