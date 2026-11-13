import { type DateKey, type DateInput } from '@/lib/date-key'

/** How work sessions are sliced in the UI. */
export const WORK_SESSION_FILTERS = [
  'all',
  'work_only',
  'freelance_only',
] as const

export type WorkSessionFilter = (typeof WORK_SESSION_FILTERS)[number]

/** Derived, indexable classification of a session. */
export const WORK_KINDS = ['company', 'freelance'] as const

export type WorkKind = (typeof WORK_KINDS)[number]

/** Suggested task types (mostly WordPress agency work). Custom strings allowed. */
export const WORK_TASK_TYPES = [
  'header',
  'footer',
  'course',
  'landing-page',
  'plugin',
  'theme',
  'bugfix',
  'maintenance',
  'seo',
  'content',
  'design',
  'meeting',
  'revision',
  'other',
] as const

export type KnownWorkTaskType = (typeof WORK_TASK_TYPES)[number]

/**
 * Known task types power the UI suggestions, while custom strings stay valid so
 * new client work never requires a code change.
 */
export type WorkSessionTaskType = KnownWorkTaskType | (string & {})

export function isWorkSessionFilter(
  value: unknown
): value is WorkSessionFilter {
  return WORK_SESSION_FILTERS.some((filter) => filter === value)
}

export function isKnownWorkTaskType(
  value: unknown
): value is KnownWorkTaskType {
  return WORK_TASK_TYPES.some((taskType) => taskType === value)
}

/** A logged chunk of work, either for the company or for a freelance client. */
export interface WorkSession {
  id: string
  /** Set only when this record mirrors time owned by a timeline block. */
  timelineBlockId?: string
  clientName: string
  taskType: WorkSessionTaskType
  durationHours: number
  date: string
  isCompanyWork: boolean
  notes?: string
  createdAt: string
  updatedAt: string
}

/**
 * Persisted shape of a session.
 *
 * IndexedDB cannot index booleans, so `kind` mirrors `isCompanyWork` and backs
 * the `by_kind` index used by the `work_only` / `freelance_only` filters.
 */
export interface WorkSessionRecord extends WorkSession {
  dateKey: DateKey
  kind: WorkKind
}

export interface WorkSessionInput {
  id?: string
  timelineBlockId?: string
  clientName: string
  taskType: WorkSessionTaskType
  durationHours: number
  date: DateInput
  isCompanyWork: boolean
  notes?: string
}

export type WorkSessionPatch = Partial<WorkSessionInput>

/** Aggregated work hours for a day or a range. */
export interface WorkTotals {
  totalHours: number
  companyHours: number
  freelanceHours: number
  sessionCount: number
  clientNames: string[]
}
