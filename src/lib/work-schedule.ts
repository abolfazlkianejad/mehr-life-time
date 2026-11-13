import type { TimelineBlockRecord } from '@/types/timeline'

const ACTIVE_SCHEDULE_STATES = new Set(['planned', 'in_progress', 'paused', 'rolled_over'])

export function intersectsLunch(start: Date, end: Date): boolean {
  const lunchStart = new Date(start)
  lunchStart.setHours(13, 0, 0, 0)
  const lunchEnd = new Date(start)
  lunchEnd.setHours(14, 0, 0, 0)
  return start < lunchEnd && end > lunchStart
}

export function findWorkTaskConflict(
  candidate: Pick<TimelineBlockRecord, 'id' | 'startTime' | 'endTime'>,
  records: TimelineBlockRecord[]
): TimelineBlockRecord | undefined {
  const start = new Date(candidate.startTime).getTime()
  const end = new Date(candidate.endTime).getTime()
  return records.find((record) =>
    record.id !== candidate.id && ACTIVE_SCHEDULE_STATES.has(record.status) &&
    start < new Date(record.endTime).getTime() && end > new Date(record.startTime).getTime()
  )
}

export function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export interface BusyInterval {
  startTime: string
  endTime: string
  status?: TimelineBlockRecord['status']
}

export interface NextSlotOptions {
  horizonDays?: number
  dayStartHour?: number
  dayEndHour?: number
  stepMinutes?: number
}

const INACTIVE_SCHEDULE_STATES = new Set(['completed', 'skipped'])

/**
 * Finds the nearest free work slot at or after `desiredStart`.
 *
 * The search skips the protected lunch hour, rounds to a 15-minute grid, and
 * never returns an interval that overlaps an active stored block. It returns
 * `null` when the horizon has no gap large enough.
 */
export function findNextFreeSlot(
  desiredStart: Date,
  durationMinutes: number,
  busy: BusyInterval[],
  options: NextSlotOptions = {}
): Date | null {
  if (!Number.isFinite(desiredStart.getTime()) || durationMinutes < 1) return null

  const horizonDays = options.horizonDays ?? 21
  const dayStartHour = options.dayStartHour ?? 8
  const dayEndHour = options.dayEndHour ?? 21
  const stepMinutes = options.stepMinutes ?? 15
  const stepMs = stepMinutes * 60_000
  const durationMs = durationMinutes * 60_000

  const intervals = busy
    .filter((item) => !INACTIVE_SCHEDULE_STATES.has(item.status ?? 'planned'))
    .map((item) => ({ start: Date.parse(item.startTime), end: Date.parse(item.endTime) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)

  let candidate = new Date(Math.ceil(desiredStart.getTime() / stepMs) * stepMs)

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const day = new Date(
      desiredStart.getFullYear(),
      desiredStart.getMonth(),
      desiredStart.getDate() + dayOffset
    )
    const windowStart = new Date(day)
    windowStart.setHours(dayStartHour, 0, 0, 0)
    const windowEnd = new Date(day)
    windowEnd.setHours(dayEndHour, 0, 0, 0)

    if (candidate < windowStart) candidate = windowStart

    while (candidate.getTime() + durationMs <= windowEnd.getTime()) {
      const end = new Date(candidate.getTime() + durationMs)
      if (intersectsLunch(candidate, end)) {
        candidate = new Date(day)
        candidate.setHours(14, 0, 0, 0)
        continue
      }

      const startMs = candidate.getTime()
      const endMs = end.getTime()
      const overlaps = intervals.some(
        (interval) => startMs < interval.end && endMs > interval.start
      )
      if (!overlaps) return new Date(candidate)
      candidate = new Date(startMs + stepMs)
    }

    candidate = new Date(day)
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(dayStartHour, 0, 0, 0)
  }

  return null
}
