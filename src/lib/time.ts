/**
 * Shared 24-hour clock helpers.
 *
 * Every clock label in the app is rendered through this module so the visible
 * format is always `HH:MM` (00:00–23:59), regardless of the browser or OS
 * locale. Values are stored as local ISO timestamps and `HH:MM` strings; this
 * module only changes presentation, never storage.
 */
import {
  formatTime24,
  formatTime24Seconds,
  toEnglishDigits,
  toPersianDigits,
} from './jalali'

export { toEnglishDigits, toPersianDigits }

/** Strict 24-hour clock text: `00:00` through `23:59`. */
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** Whether a string is already a strict `HH:MM` 24-hour value. */
export function isClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value)
}

/**
 * Normalizes user-typed clock text into `HH:MM`.
 *
 * Accepts ASCII, Persian and Arabic-Indic digits and the separators `:`, `.`
 * and the full-width colon. `9:5`, `09:05`, `0905` and `905` all normalize to
 * `09:05`. Returns `null` for anything outside 00:00–23:59.
 */
export function normalizeClockTime(input: string): string | null {
  const text = toEnglishDigits(input).trim()
  if (!text) return null

  let hoursText: string
  let minutesText: string

  const separated = /^(\d{1,2})[:.\uFF1A](\d{1,2})$/.exec(text)
  if (separated) {
    hoursText = separated[1]!
    minutesText = separated[2]!
  } else if (/^\d{3,4}$/.test(text)) {
    const compact = text.padStart(4, '0')
    hoursText = compact.slice(0, 2)
    minutesText = compact.slice(2)
  } else {
    return null
  }

  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Local `HH:MM` value of a date; an empty string for invalid dates. */
export function clockTimeFromDate(date: Date): string {
  return Number.isFinite(date.getTime()) ? formatTime24(date) : ''
}

/** Converts a `HH:MM` value to Persian digits when the UI language is Persian. */
export function localizeClockTime(value: string, language?: string): string {
  return language?.startsWith('fa') ? toPersianDigits(value) : value
}

/** 24-hour `HH:MM` label of a date, with Persian digits in the Persian UI. */
export function formatClockTime(date: Date, language?: string): string {
  const value = clockTimeFromDate(date)
  return value ? localizeClockTime(value, language) : '—'
}

/** 24-hour label of an already-stored `HH:MM` text value. */
export function formatClockTimeValue(
  value: string | undefined,
  language?: string
): string {
  if (!value) return '—'
  const normalized = normalizeClockTime(value)
  return normalized ? localizeClockTime(normalized, language) : value
}

/** 24-hour `HH:MM:SS` label of a date, with Persian digits in the Persian UI. */
export function formatClockTimeSeconds(date: Date, language?: string): string {
  if (!Number.isFinite(date.getTime())) return '—'
  return localizeClockTime(formatTime24Seconds(date), language)
}

/**
 * Builds a local `Date` from a day key and an `HH:MM` value.
 * Returns `null` when either part is missing or out of range.
 */
export function clockDateFromParts(dateKey: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const normalized = normalizeClockTime(time)
  if (!normalized) return null
  const date = new Date(`${dateKey}T${normalized}:00`)
  return Number.isFinite(date.getTime()) ? date : null
}
