/**
 * Pure range and aggregation helpers for the analytics center.
 *
 * All day keys are local `yyyy-MM-dd` strings and all date arithmetic uses UTC
 * midnight so a timezone or DST change never shifts a day. Jalali month
 * boundaries are used for the month presets so the labels match the UI.
 */
import {
  dateKeyToJalali,
  formatJalaliDateKey,
  jalaliMonthLength,
  jalaliToDateKey,
} from '@/lib/jalali'
import { dayKeysBetween, weekKeysOf } from '@/features/goals/goal-utils'

export const RANGE_PRESETS = [
  'day',
  'threeDays',
  'week',
  'twoWeeks',
  'thisMonth',
  'lastMonth',
  'threeMonths',
  'custom',
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export interface RangeBounds {
  from: string
  to: string
}

const DAY_MS = 86_400_000

function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function keyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`
}

export function shiftDayKey(key: string, delta: number): string {
  return keyOf(new Date(parseKey(key).getTime() + delta * DAY_MS))
}

/** Full Jalali month range, `offset` months away from the reference day. */
export function jalaliMonthRange(
  offset: number,
  referenceKey: string
): RangeBounds {
  const { jy, jm } = dateKeyToJalali(referenceKey)
  let year = jy
  let month = jm + offset
  while (month < 1) {
    month += 12
    year -= 1
  }
  while (month > 12) {
    month -= 12
    year += 1
  }
  return {
    from: jalaliToDateKey(year, month, 1),
    to: jalaliToDateKey(year, month, jalaliMonthLength(year, month)),
  }
}

/** Start key of the Jalali month `offset` months away from the reference day. */
export function jalaliMonthStart(offset: number, referenceKey: string): string {
  const { jy, jm } = dateKeyToJalali(referenceKey)
  let year = jy
  let month = jm + offset
  while (month < 1) {
    month += 12
    year -= 1
  }
  while (month > 12) {
    month -= 12
    year += 1
  }
  return jalaliToDateKey(year, month, 1)
}

/** Resolves one of the range presets; `custom` keeps the seeded range. */
export function presetRange(
  preset: RangePreset,
  todayKey: string
): RangeBounds {
  const week = weekKeysOf(todayKey)
  switch (preset) {
    case 'day':
      return { from: todayKey, to: todayKey }
    case 'threeDays':
      return { from: shiftDayKey(todayKey, -2), to: todayKey }
    case 'week':
      return { from: week[0]!, to: week[6]! }
    case 'twoWeeks':
      return { from: shiftDayKey(week[0]!, -7), to: week[6]! }
    case 'thisMonth':
      return jalaliMonthRange(0, todayKey)
    case 'lastMonth':
      return jalaliMonthRange(-1, todayKey)
    case 'threeMonths':
      return { from: jalaliMonthStart(-2, todayKey), to: todayKey }
    case 'custom':
    default:
      return { from: todayKey, to: todayKey }
  }
}

/**
 * The comparable previous range. Weeks/days use an equal-length window ending
 * the day before `from`; month presets use the exact previous Jalali month.
 */
export function previousRange(
  fromKey: string,
  toKey: string,
  preset: RangePreset,
  todayKey: string
): RangeBounds | null {
  if (preset === 'thisMonth') return jalaliMonthRange(-2, todayKey)
  if (preset === 'lastMonth') return jalaliMonthRange(-3, todayKey)
  const length = dayKeysBetween(fromKey, toKey).length
  if (!length) return null
  return { from: shiftDayKey(fromKey, -length), to: shiftDayKey(fromKey, -1) }
}

export function isValidRange(fromKey: string, toKey: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(fromKey) &&
    /^\d{4}-\d{2}-\d{2}$/.test(toKey) &&
    fromKey <= toKey
  )
}

/** `23:30` → `06:15` is 6h45m; a bedtime after midnight is handled. */
export function sleepMinutesBetween(
  sleepTime: string,
  wakeTime: string
): number | null {
  if (!sleepTime || !wakeTime) return null
  const [sleepHour, sleepMinute] = sleepTime.split(':').map(Number)
  const [wakeHour, wakeMinute] = wakeTime.split(':').map(Number)
  if (
    [sleepHour, sleepMinute, wakeHour, wakeMinute].some(
      (value) => !Number.isFinite(value)
    )
  ) {
    return null
  }
  let minutes = wakeHour * 60 + wakeMinute - (sleepHour * 60 + sleepMinute)
  if (minutes < 0) minutes += 24 * 60
  return minutes
}

/** Saturday-first weekday index: Saturday = 0 … Friday = 6. */
export function weekdayIndexOf(dayKey: string): number {
  return (parseKey(dayKey).getUTCDay() + 1) % 7
}

export interface WeekdayAverage {
  weekday: number
  average: number
  days: number
}

/** Average of `byDay` for each weekday present in `days`. */
export function weekdayAverages(
  byDay: Record<string, number>,
  days: string[]
): WeekdayAverage[] {
  const sums = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }))
  for (const day of days) {
    const index = weekdayIndexOf(day)
    sums[index]!.total += byDay[day] ?? 0
    sums[index]!.days += 1
  }
  return sums.map((entry, weekday) => ({
    weekday,
    average: entry.days ? entry.total / entry.days : 0,
    days: entry.days,
  }))
}

/** Running total of `byDay` across `days`. */
export function cumulativeSeries(
  byDay: Record<string, number>,
  days: string[]
): number[] {
  let total = 0
  return days.map((day) => {
    total += byDay[day] ?? 0
    return total
  })
}

export function sharePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  return (part / total) * 100
}

/** Short Jalali axis label, e.g. `08/21`. */
export function shortJalaliLabel(dayKey: string): string {
  const full = formatJalaliDateKey(dayKey)
  return full.includes('/') ? full.slice(5) : full
}

export function sumValues(map: Record<string, number>, days: string[]): number {
  return days.reduce((total, day) => total + (map[day] ?? 0), 0)
}

/**
 * Percentage change between two comparable totals.
 *
 * Returns `null` when the previous value is zero (a percentage of zero is not
 * meaningful) or when the signs differ, so the UI never claims a fake `+100%`.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return null
  if (previous < 0 !== current < 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Average over the days that actually have a value. */
export function averageDefined(
  byDay: Record<string, number | null>,
  days: string[]
): number | null {
  let total = 0
  let count = 0
  for (const day of days) {
    const value = byDay[day]
    if (value === null || value === undefined || !Number.isFinite(value))
      continue
    total += value
    count += 1
  }
  return count ? total / count : null
}
