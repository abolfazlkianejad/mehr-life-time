import type { TimelineBlockRecord } from '@/types/timeline'
import type { WorkSessionRecord } from '@/types/work'

export type WorkTimeFilter = 'company' | 'freelance' | 'all'

type TimedBlock = Pick<TimelineBlockRecord, 'id' | 'elapsedSeconds' | 'timerStartedAt' | 'isCompanyWork' | 'status'>

function wholeSeconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0
}

/** Stored timer duration plus a valid active interval, clamped against bad clocks/data. */
export function timelineBlockSeconds(block: Pick<TimedBlock, 'elapsedSeconds' | 'timerStartedAt'> & Partial<Pick<TimedBlock, 'status'>>, now = Date.now()): number {
  const stored = wholeSeconds(block.elapsedSeconds)
  if (block.status && block.status !== 'in_progress') return stored
  if (!block.timerStartedAt || !Number.isFinite(now)) return stored
  const started = Date.parse(block.timerStartedAt)
  if (!Number.isFinite(started)) return stored
  const live = wholeSeconds((now - started) / 1000)
  return Math.min(Number.MAX_SAFE_INTEGER, stored + live)
}

/** Settles an active timer before pause, completion, or rollover clears its start timestamp. */
export function settleTimelineBlockSeconds(block: Pick<TimedBlock, 'elapsedSeconds' | 'timerStartedAt' | 'status'>, now = Date.now()): number {
  return timelineBlockSeconds(block, now)
}

/**
 * One shared aggregate for task reports and day review. Linked legacy session
 * rows are ignored because the timeline block owns their duration. Unlinked
 * sessions remain independent, including old rows without a source id.
 */
export function calculateWorkTime(
  blocks: TimedBlock[],
  sessions: WorkSessionRecord[],
  filter: WorkTimeFilter = 'all',
  now = Date.now()
): { seconds: number; blockSeconds: number; independentSessionSeconds: number; sessions: WorkSessionRecord[] } {
  const selectedBlocks = blocks.filter((block) => filter === 'all' || (filter === 'company' ? block.isCompanyWork !== false : block.isCompanyWork === false))
  const seenBlocks = new Set<string>()
  let blockSeconds = 0
  for (const block of selectedBlocks) {
    if (seenBlocks.has(block.id)) continue
    seenBlocks.add(block.id)
    blockSeconds = Math.min(Number.MAX_SAFE_INTEGER, blockSeconds + timelineBlockSeconds(block, now))
  }
  const selectedBlockIds = new Set(selectedBlocks.map((block) => block.id))

  const seenSessions = new Set<string>()
  const independentSessions: WorkSessionRecord[] = []
  let independentSessionSeconds = 0
  for (const session of sessions) {
    if (seenSessions.has(session.id)) continue
    seenSessions.add(session.id)
    // A linked interval is represented by its timeline block only while that
    // block is in the selected date/filter range. If the task was rolled to a
    // later day, retain its earlier dated interval in the report.
    if (session.timelineBlockId && selectedBlockIds.has(session.timelineBlockId)) continue
    if (filter === 'company' && !session.isCompanyWork) continue
    if (filter === 'freelance' && session.isCompanyWork) continue
    independentSessions.push(session)
    const hours = session.durationHours
    if (!Number.isFinite(hours) || hours <= 0) continue
    independentSessionSeconds = Math.min(Number.MAX_SAFE_INTEGER, independentSessionSeconds + Math.round(hours * 3600))
  }

  return {
    seconds: Math.min(Number.MAX_SAFE_INTEGER, blockSeconds + independentSessionSeconds),
    blockSeconds,
    independentSessionSeconds,
    sessions: independentSessions,
  }
}
