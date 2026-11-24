/**
 * Pure goal calculations shared by the goals page, the dashboard and analytics.
 *
 * Daily and weekly numbers come from the same per-day activity map, so a weekly
 * total is exactly the sum of its seven daily values and a session/hour is
 * never counted twice.
 */
import type { GoalPeriod } from '@/services/goals'

const DAY_MS = 86_400_000

export type GoalStatus = 'below' | 'met' | 'unset'

export interface GoalProgress {
  target: number
  actual: number
  /** `actual - target`; negative means the target is not reached yet. */
  diff: number
  /** 0–100, capped for the progress bar; `0` when no target exists. */
  percent: number
  /** Raw percentage (may exceed 100) used for labels. */
  rawPercent: number
  status: GoalStatus
}

/** Below target is red, at/above target is green. */
export function evaluateGoal(
  target: number | undefined,
  actual: number
): GoalProgress {
  const safeActual = Number.isFinite(actual) ? Math.max(0, actual) : 0
  if (!target || !Number.isFinite(target) || target <= 0) {
    return {
      target: 0,
      actual: safeActual,
      diff: safeActual,
      percent: 0,
      rawPercent: 0,
      status: 'unset',
    }
  }
  const rawPercent = (safeActual / target) * 100
  return {
    target,
    actual: safeActual,
    diff: safeActual - target,
    percent: Math.min(100, rawPercent),
    rawPercent,
    status: safeActual >= target ? 'met' : 'below',
  }
}

export function goalStatusColor(
  status: GoalStatus
): 'destructive' | 'success' | 'muted' {
  if (status === 'met') return 'success'
  if (status === 'below') return 'destructive'
  return 'muted'
}

/** `3:05` style hours:minutes from seconds (24-hour, locale-neutral digits). */
export function formatHoursMinutes(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/** Hours with at most one decimal, for editable inputs. */
export function secondsToHoursInput(seconds: number): string {
  const hours = Math.max(0, seconds) / 3600
  return String(Math.round(hours * 100) / 100)
}

export function hoursToSeconds(hours: string | number): number {
  const value = typeof hours === 'number' ? hours : Number(hours)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 3600)
}

/** `۱۴۰۵/۰۸/۲۱`-independent weekday label for a local day key. */
export function weekdayLabel(dateKey: string, language: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`)
  return new Intl.DateTimeFormat(
    language.startsWith('fa') ? 'fa-IR' : 'en-US',
    {
      weekday: 'long',
      timeZone: 'UTC',
    }
  ).format(date)
}

function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function keyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Seven day keys of the week that contains `dateKey`, Saturday first. */
export function weekKeysOf(dateKey: string): string[] {
  const date = parseKey(dateKey)
  const offset = (date.getUTCDay() + 1) % 7
  const start = new Date(date.getTime() - offset * DAY_MS)
  return Array.from({ length: 7 }, (_, index) =>
    keyOf(new Date(start.getTime() + index * DAY_MS))
  )
}

/** Inclusive day keys between two valid day keys, oldest first. */
export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromKey) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toKey)
  )
    return []
  const start = parseKey(fromKey)
  const end = parseKey(toKey)
  if (end < start) return []
  const keys: string[] = []
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    if (keys.length > 3660) break
    keys.push(keyOf(new Date(time)))
  }
  return keys
}

/**
 * The share of a weekly target assigned to one day. A weekly target is split
 * evenly across the seven days (the goals page shows each share explicitly).
 */
export function weeklyDayShare(target: number): number {
  return target > 0 ? target / 7 : 0
}

/**
 * Progress of one goal over a period. `byDay` must contain real seconds (or
 * session counts) keyed by the same day keys; missing days are zero.
 */
export function periodProgress(
  period: GoalPeriod,
  target: number | undefined,
  byDay: Record<string, number>,
  days: string[]
): {
  progress: GoalProgress
  dayShares: Array<{ dayKey: string; actual: number; share: number }>
} {
  const actual = days.reduce((total, day) => total + (byDay[day] ?? 0), 0)
  const progress = evaluateGoal(target, actual)
  const share =
    period === 'weekly' ? weeklyDayShare(target ?? 0) : (target ?? 0)
  return {
    progress,
    dayShares: days.map((dayKey) => ({
      dayKey,
      actual: byDay[dayKey] ?? 0,
      share,
    })),
  }
}
