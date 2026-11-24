import type {
  TaskPriority,
  TimelineBlockRecord,
  TimelineCategory,
} from '@/types/timeline'
import { clockTimeFromDate } from '@/lib/time'
import type { LearningTrack } from '@/services/db'
import type { EducationTask } from '@/services/education'
import { displayTaskStatus } from '@/features/learning/education-utils'

/**
 * Read-only aggregation of the two task modules for the dashboard.
 *
 * No records are written, duplicated or merged here: work tasks come from
 * `timelineBlocks` and education tasks from `educationTasks`, and every action
 * still goes through the service of its own module.
 */
export type UnifiedTaskSource = 'work' | 'education'

/** Normalized lifecycle used by the dashboard filters. */
export type UnifiedTaskBucket = 'open' | 'active' | 'done'

export interface UnifiedTask {
  /** Stable identity across both sources, e.g. `education:edu_x1`. */
  key: string
  source: UnifiedTaskSource
  id: string
  title: string
  /** Gregorian local day key of the planned date. */
  dateKey: string
  /** Strict `HH:MM` 24-hour planned time. */
  time: string
  priority: TaskPriority
  bucket: UnifiedTaskBucket
  /** Original module status, labeled with the module's own translations. */
  status: string
  /** Planned duration in minutes; both modules always store one. */
  estimatedMinutes: number
  /** Module-specific fields; absent instead of fabricated. */
  track?: LearningTrack
  category?: TimelineCategory
  isCompanyWork?: boolean
  projectId?: string
  courseId?: string
  notes?: string
  description?: string
  /** Settled seconds; the live interval is added at render time. */
  elapsedSeconds?: number
  timerStartedAt?: string
  createdAt: string
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
}

/** Open and active tasks both outrank finished ones. */
const BUCKET_RANK: Record<UnifiedTaskBucket, number> = {
  open: 0,
  active: 0,
  done: 1,
}

function workBucket(task: TimelineBlockRecord): UnifiedTaskBucket {
  if (task.status === 'completed' || task.status === 'skipped') return 'done'
  if (task.status === 'planned' || task.status === 'rolled_over') return 'open'
  return 'active'
}

function educationBucket(task: EducationTask): UnifiedTaskBucket {
  if (task.status === 'completed') return 'done'
  if (task.status === 'pending') return 'open'
  return 'active'
}

export function buildUnifiedTasks(
  workTasks: TimelineBlockRecord[],
  educationTasks: EducationTask[]
): UnifiedTask[] {
  const tasks: UnifiedTask[] = []
  for (const task of workTasks) {
    tasks.push({
      key: `work:${task.id}`,
      source: 'work',
      id: task.id,
      title: task.title,
      dateKey: task.dateKey,
      time: clockTimeFromDate(new Date(task.startTime)),
      priority: task.priority ?? 'medium',
      bucket: workBucket(task),
      status:
        task.status === 'in_progress' && !task.timerStartedAt
          ? 'paused'
          : task.status,
      estimatedMinutes: task.durationMinutes,
      category: task.category,
      isCompanyWork: task.isCompanyWork,
      ...(task.projectId ? { projectId: task.projectId } : {}),
      ...(task.notes ? { notes: task.notes } : {}),
      ...(task.elapsedSeconds !== undefined
        ? { elapsedSeconds: task.elapsedSeconds }
        : {}),
      ...(task.timerStartedAt ? { timerStartedAt: task.timerStartedAt } : {}),
      createdAt: task.createdAt,
    })
  }
  for (const task of educationTasks) {
    tasks.push({
      key: `education:${task.id}`,
      source: 'education',
      id: task.id,
      title: task.title,
      dateKey: task.dateKey,
      time: task.time,
      priority: task.priority,
      bucket: educationBucket(task),
      status: displayTaskStatus(task),
      estimatedMinutes: task.estimatedMinutes,
      track: task.track,
      ...(task.courseId ? { courseId: task.courseId } : {}),
      ...(task.description ? { description: task.description } : {}),
      elapsedSeconds: task.actualSeconds,
      ...(task.timerStartedAt ? { timerStartedAt: task.timerStartedAt } : {}),
      createdAt: task.createdAt,
    })
  }
  return tasks
}

export interface UnifiedTaskFilters {
  source: 'all' | UnifiedTaskSource
  /**
   * Exact local day (`yyyy-MM-dd`) the dashboard is showing. An empty value
   * disables the date restriction; the UI always passes a real day key.
   */
  dateKey: string
  status: UnifiedStatusFilter
  priority: 'all' | TaskPriority
  /** Real project id from the work-task store; `all` disables the filter. */
  projectId: 'all' | string
  query: string
}

export const UNIFIED_STATUS_FILTERS = [
  'all',
  'done',
  'open',
  'active',
  'paused',
] as const

export type UnifiedStatusFilter = (typeof UNIFIED_STATUS_FILTERS)[number]

export const DEFAULT_UNIFIED_TASK_FILTERS: UnifiedTaskFilters = {
  source: 'all',
  dateKey: '',
  status: 'all',
  priority: 'all',
  projectId: 'all',
  query: '',
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Shape check for a stored `yyyy-MM-dd` day key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && DAY_KEY_PATTERN.test(value)
}

/** Status of a row as one of the five user-facing filter buckets. */
export function matchesStatusFilter(
  task: UnifiedTask,
  status: UnifiedStatusFilter
): boolean {
  if (status === 'all') return true
  if (status === 'done') return task.bucket === 'done'
  if (status === 'paused') return task.status === 'paused'
  if (status === 'open') return task.bucket === 'open'
  return task.bucket === 'active' && task.status !== 'paused'
}

/**
 * Applies every active filter. The day key is compared as the exact stored
 * string, so a selected day never leaks tasks from neighbouring days.
 */
export function filterUnifiedTasks(
  tasks: UnifiedTask[],
  filters: UnifiedTaskFilters
): UnifiedTask[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const restrictDay = isDayKey(filters.dateKey)
  return tasks.filter((task) => {
    if (restrictDay && task.dateKey !== filters.dateKey) return false
    if (filters.source !== 'all' && task.source !== filters.source) return false
    if (!matchesStatusFilter(task, filters.status)) return false
    if (filters.priority !== 'all' && task.priority !== filters.priority)
      return false
    if (filters.projectId !== 'all' && task.projectId !== filters.projectId)
      return false
    if (query && !task.title.toLocaleLowerCase().includes(query)) return false
    return true
  })
}

export type UnifiedTaskSort = 'smart' | 'priority' | 'date' | 'time'

function compareSchedule(a: UnifiedTask, b: UnifiedTask): number {
  return a.dateKey.localeCompare(b.dateKey) || a.time.localeCompare(b.time)
}

function compareCreated(a: UnifiedTask, b: UnifiedTask): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/**
 * Default order: open and active tasks first, then priority, then the planned
 * date and time. Every sort keeps a deterministic creation-time tie-breaker.
 */
export function sortUnifiedTasks(
  tasks: UnifiedTask[],
  sort: UnifiedTaskSort
): UnifiedTask[] {
  const rows = [...tasks]
  if (sort === 'priority') {
    return rows.sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        compareSchedule(a, b) ||
        compareCreated(a, b)
    )
  }
  if (sort === 'date') {
    return rows.sort(
      (a, b) =>
        compareSchedule(a, b) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        compareCreated(a, b)
    )
  }
  if (sort === 'time') {
    return rows.sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        a.dateKey.localeCompare(b.dateKey) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        compareCreated(a, b)
    )
  }
  return rows.sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      compareSchedule(a, b) ||
      compareCreated(a, b)
  )
}

export interface UnifiedTaskCounts {
  total: number
  completed: number
  remaining: number
}

export function summarizeUnifiedTasks(tasks: UnifiedTask[]): UnifiedTaskCounts {
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.bucket === 'done').length,
    remaining: tasks.filter((task) => task.bucket !== 'done').length,
  }
}
