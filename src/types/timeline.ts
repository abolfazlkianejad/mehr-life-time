import { type DateKey, type DateInput } from '@/lib/date-key'

/** Categories of the central life/work timeline. */
export const TIMELINE_CATEGORIES = [
  'work',
  'freelance',
  'study',
  'workout',
  'nutrition',
  'buffer',
  'sleep',
] as const

export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number]

/** Lifecycle of a planned block. */
export const TIMELINE_BLOCK_STATUSES = [
  'planned',
  'in_progress',
  'paused',
  'rolled_over',
  'completed',
  'skipped',
] as const

export type TimelineBlockStatus = (typeof TIMELINE_BLOCK_STATUSES)[number]

/** Energy scale used for both "required energy" and logged energy. */
export const ENERGY_SCORES = [1, 2, 3, 4, 5] as const

export type EnergyScore = (typeof ENERGY_SCORES)[number]

/** User-facing priority for work tasks. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.some((priority) => priority === value)
}

export function isTimelineCategory(value: unknown): value is TimelineCategory {
  return TIMELINE_CATEGORIES.some((category) => category === value)
}

export function isTimelineBlockStatus(
  value: unknown
): value is TimelineBlockStatus {
  return TIMELINE_BLOCK_STATUSES.some((status) => status === value)
}

export function isEnergyScore(value: unknown): value is EnergyScore {
  return ENERGY_SCORES.some((score) => score === value)
}

/**
 * A single planned block on the central timeline.
 *
 * `startTime`/`endTime` are stored as ISO 8601 strings so records survive
 * `structuredClone` in IndexedDB without timezone drift.
 */
export interface TimelineBlock {
  id: string
  title: string
  category: TimelineCategory
  startTime: string
  endTime: string
  durationMinutes: number
  energyLevelRequired: EnergyScore
  status: TimelineBlockStatus
  isConflictFree: boolean
  notes?: string
  createdAt: string
  updatedAt: string
  /** Accumulated timer time, persisted so reloads do not reset a task. */
  elapsedSeconds?: number
  /** Non-null only while this block owns the single active work timer. */
  timerStartedAt?: string
  /** Source date when this unfinished block was moved forward. */
  rolledOverFrom?: DateKey
  /** Work report classification. Existing timeline blocks default to company work. */
  isCompanyWork?: boolean
  /** Optional priority badge. Older records default to `medium`. */
  priority?: TaskPriority
  /** Optional link to a personal project (see `src/services/projects.ts`). */
  projectId?: string
}

/**
 * Persisted shape of a block: adds the derived local day key used by the
 * IndexedDB `by_date_key` index.
 */
export interface TimelineBlockRecord extends TimelineBlock {
  dateKey: DateKey
}

/** Payload accepted when creating or patching a block. */
export interface TimelineBlockInput {
  id?: string
  title: string
  category: TimelineCategory
  startTime: DateInput
  endTime?: DateInput
  durationMinutes?: number
  energyLevelRequired: EnergyScore
  status?: TimelineBlockStatus
  isConflictFree?: boolean
  notes?: string
  elapsedSeconds?: number
  timerStartedAt?: string
  rolledOverFrom?: DateKey
  isCompanyWork?: boolean
  priority?: TaskPriority
  /** Optional link to a personal project. */
  projectId?: string
}

/** Partial payload for updates; unresolved fields fall back to the stored row. */
export type TimelineBlockPatch = Partial<TimelineBlockInput>

/** Aggregate view of one timeline day, ready for dashboard cards. */
export interface TimelineDaySummary {
  dateKey: DateKey
  totalBlocks: number
  completedBlocks: number
  skippedBlocks: number
  plannedMinutes: number
  completedMinutes: number
  conflictCount: number
  minutesByCategory: Record<TimelineCategory, number>
}

/** A manual energy check-in. */
export interface EnergyLog {
  id: string
  timestamp: string
  score: EnergyScore
  note: string
  createdAt: string
  updatedAt: string
}

/** Persisted shape of an energy log (adds the derived local day key). */
export interface EnergyLogRecord extends EnergyLog {
  dateKey: DateKey
}

export interface EnergyLogInput {
  id?: string
  timestamp: DateInput
  score: EnergyScore
  note?: string
}

export type EnergyLogPatch = Partial<EnergyLogInput>

/** One point of the daily energy trend. */
export interface EnergyTrendPoint {
  dateKey: DateKey
  averageScore: number
  latestScore: EnergyScore
  logCount: number
}
