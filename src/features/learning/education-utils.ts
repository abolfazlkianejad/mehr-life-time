import type { TaskPriority } from '@/types/timeline'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import type { LearningTrack } from '@/services/db'
import {
  educationElapsedSeconds,
  educationSecondsOnDay,
  type EducationReport,
  type EducationTask,
  type EducationTaskStatus,
} from '@/services/education'
import type { EducationItem } from '@/services/learning'

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
}

/** `HH:MM:SS` duration with the same shape used by the work timer. */
export function formatStudyDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

/** Jalali creation date of a course; `—` for legacy rows without a valid date. */
export function formatEducationCreatedAt(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return formatJalaliDateKey(toDateKey(date))
}

export type EducationTaskSort = 'priority' | 'date' | 'time'

export type EducationTaskStatusFilter = 'open' | 'all' | EducationTaskStatus

export interface EducationTaskFilters {
  track: 'all' | LearningTrack
  courseId: 'all' | string
  status: EducationTaskStatusFilter
  query: string
}

/**
 * Status shown to the user. A persisted `in_progress` row without a running
 * interval is a paused timer (for example after a browser restart).
 */
export function displayTaskStatus(task: EducationTask): EducationTaskStatus {
  if (task.status === 'in_progress' && !task.timerStartedAt) return 'paused'
  return task.status
}

function compareSchedule(a: EducationTask, b: EducationTask): number {
  return a.dateKey.localeCompare(b.dateKey) || a.time.localeCompare(b.time)
}

/** Default order: higher priority first, then nearer date, then earlier time. */
export function sortEducationTasks(
  tasks: EducationTask[],
  sort: EducationTaskSort
): EducationTask[] {
  const rows = [...tasks]
  if (sort === 'date') {
    return rows.sort(
      (a, b) =>
        compareSchedule(a, b) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    )
  }
  if (sort === 'time') {
    return rows.sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        compareSchedule(a, b) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    )
  }
  return rows.sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      compareSchedule(a, b)
  )
}

/**
 * Filters the shared task list without losing completed history. The caller
 * renders completed tasks in a separate section so the upcoming list stays
 * clean.
 */
export function filterEducationTasks(
  tasks: EducationTask[],
  filters: EducationTaskFilters
): EducationTask[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return tasks.filter((task) => {
    if (filters.track !== 'all' && task.track !== filters.track) return false
    if (filters.courseId !== 'all' && task.courseId !== filters.courseId)
      return false
    const status = displayTaskStatus(task)
    if (filters.status === 'open' && status === 'completed') return false
    if (
      filters.status !== 'open' &&
      filters.status !== 'all' &&
      status !== filters.status
    ) {
      return false
    }
    if (query && !task.title.toLocaleLowerCase().includes(query)) return false
    return true
  })
}

/** Dates of the current week, starting on Saturday (Persian calendar week). */
export function currentWeekKeys(now = new Date()): string[] {
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay(): 0 = Sunday … 6 = Saturday. Saturday is the first day here.
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 1) % 7))
  const keys: string[] = []
  for (let index = 0; index < 7; index += 1) {
    const day = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + index
    )
    keys.push(toDateKey(day))
  }
  return keys
}

export interface EducationSummary {
  todayTasks: number
  completedToday: number
  remainingToday: number
  studyTodaySeconds: number
  studyWeekSeconds: number
  activeCourses: number
  activeTask?: EducationTask
}

/**
 * Dashboard summary of the shared education system. Totals are derived from
 * persisted per-day seconds, so they survive a refresh and never double count
 * the running interval.
 */
export function summarizeEducation(
  tasks: EducationTask[],
  items: EducationItem[],
  nowMs = Date.now()
): EducationSummary {
  const now = new Date(nowMs)
  const today = toDateKey(now)
  const weekKeys = new Set(currentWeekKeys(now))
  const activeTask = tasks.find((task) => Boolean(task.timerStartedAt))

  return {
    todayTasks: tasks.filter((task) => task.dateKey === today).length,
    completedToday: tasks.filter(
      (task) =>
        task.status === 'completed' &&
        task.completedAt !== undefined &&
        toDateKey(new Date(task.completedAt)) === today
    ).length,
    remainingToday: tasks.filter(
      (task) => task.dateKey === today && task.status !== 'completed'
    ).length,
    studyTodaySeconds: tasks.reduce(
      (total, task) => total + educationSecondsOnDay(task, today, nowMs),
      0
    ),
    studyWeekSeconds: [...weekKeys].reduce(
      (total, day) =>
        total +
        tasks.reduce(
          (dayTotal, task) =>
            dayTotal + educationSecondsOnDay(task, day, nowMs),
          0
        ),
      0
    ),
    activeCourses: items.filter((item) => item.status === 'active').length,
    ...(activeTask ? { activeTask } : {}),
  }
}

export interface CourseSummary {
  taskCount: number
  completedTasks: number
  studiedSeconds: number
}

/** Per-course detail shown on the course card of its own path tab. */
export function summarizeCourse(
  tasks: EducationTask[],
  courseId: string,
  nowMs = Date.now()
): CourseSummary {
  const linked = tasks.filter((task) => task.courseId === courseId)
  return {
    taskCount: linked.length,
    completedTasks: linked.filter((task) => task.status === 'completed').length,
    studiedSeconds: linked.reduce(
      (total, task) => total + educationElapsedSeconds(task, nowMs),
      0
    ),
  }
}

export type EducationReportSort = 'newest' | 'oldest'

export interface EducationReportFilters {
  track: 'all' | LearningTrack
  courseId: 'all' | string
  from: string
  to: string
  query: string
  sort: EducationReportSort
}

export function filterEducationReports(
  reports: EducationReport[],
  filters: EducationReportFilters
): EducationReport[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return reports
    .filter((report) => {
      if (filters.track !== 'all' && report.track !== filters.track)
        return false
      if (filters.courseId !== 'all' && report.courseId !== filters.courseId) {
        return false
      }
      if (filters.from && report.dateKey < filters.from) return false
      if (filters.to && report.dateKey > filters.to) return false
      if (!query) return true
      return [
        report.taskTitle,
        report.courseTitle ?? '',
        report.summary,
        report.topics ?? '',
        report.exercises ?? '',
        report.problems ?? '',
        report.resumePoint ?? '',
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(query)
    })
    .sort((a, b) =>
      filters.sort === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)
    )
}

export interface ReportCourseOption {
  id: string
  title: string
}

/** Course options that actually appear in the report history. */
export function reportCourseOptions(
  reports: EducationReport[]
): ReportCourseOption[] {
  const options = new Map<string, string>()
  for (const report of reports) {
    if (!report.courseId) continue
    if (!options.has(report.courseId)) {
      options.set(report.courseId, report.courseTitle ?? '')
    }
  }
  return [...options].map(([id, title]) => ({ id, title }))
}

/** Newest report timestamp per task, used to badge task cards. */
export function reportCountByTask(
  reports: EducationReport[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const report of reports) {
    counts[report.taskId] = (counts[report.taskId] ?? 0) + 1
  }
  return counts
}
