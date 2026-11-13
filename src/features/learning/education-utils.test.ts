import { describe, expect, it } from 'vitest'
import { toDateKey } from '@/lib/date-key'
import type { EducationReport, EducationTask } from '@/services/education'
import type { EducationItem } from '@/services/learning'
import {
  currentWeekKeys,
  displayTaskStatus,
  filterEducationReports,
  filterEducationTasks,
  formatEducationCreatedAt,
  formatStudyDuration,
  reportCountByTask,
  reportCourseOptions,
  sortEducationTasks,
  summarizeCourse,
  summarizeEducation,
} from './education-utils'

const NOW = new Date(2026, 10, 12, 10, 0, 0)
const NOW_MS = NOW.getTime()
const TODAY = toDateKey(NOW)
const YESTERDAY = toDateKey(new Date(2026, 10, 11, 12, 0, 0))

function task(overrides: Partial<EducationTask> = {}): EducationTask {
  return {
    id: 'task-1',
    track: 'masters',
    title: 'Task',
    priority: 'medium',
    dateKey: TODAY,
    time: '09:00',
    estimatedMinutes: 60,
    status: 'pending',
    actualSeconds: 0,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    ...overrides,
  }
}

function report(overrides: Partial<EducationReport> = {}): EducationReport {
  return {
    id: 'report-1',
    taskId: 'task-1',
    track: 'masters',
    taskTitle: 'Task',
    taskStatus: 'completed',
    dateKey: TODAY,
    createdAt: '2026-11-12T08:00:00.000Z',
    updatedAt: '2026-11-12T08:00:00.000Z',
    durationSeconds: 600,
    summary: 'Studied chapter one',
    ...overrides,
  }
}

function item(overrides: Partial<EducationItem> = {}): EducationItem {
  return {
    id: 'course-1',
    track: 'masters',
    type: 'course',
    title: 'Course',
    status: 'active',
    progress: 0,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  }
}

describe('education sorting and filtering', () => {
  it('sorts by higher priority, then nearer date, then earlier time by default', () => {
    const rows = [
      task({ id: 'low', priority: 'low', dateKey: TODAY, time: '08:00' }),
      task({ id: 'urgent-late', priority: 'urgent', dateKey: TODAY, time: '18:00' }),
      task({ id: 'urgent-early', priority: 'urgent', dateKey: TODAY, time: '09:00' }),
      task({ id: 'urgent-tomorrow', priority: 'urgent', dateKey: '2026-11-13', time: '07:00' }),
      task({ id: 'medium', priority: 'medium', dateKey: TODAY, time: '09:00' }),
    ]
    expect(sortEducationTasks(rows, 'priority').map((entry) => entry.id)).toEqual([
      'urgent-early',
      'urgent-late',
      'urgent-tomorrow',
      'medium',
      'low',
    ])
  })

  it('supports explicit date and time sorts', () => {
    const rows = [
      task({ id: 'b', dateKey: '2026-11-13', time: '08:00' }),
      task({ id: 'a', dateKey: TODAY, time: '18:00' }),
      task({ id: 'c', dateKey: TODAY, time: '07:00' }),
    ]
    expect(sortEducationTasks(rows, 'date').map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
    expect(sortEducationTasks(rows, 'time').map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
  })

  it('filters by path, course, status and title, excluding completed from open', () => {
    const rows = [
      task({ id: 'open-masters', title: 'Linear Algebra', track: 'masters', courseId: 'c1' }),
      task({
        id: 'done-masters',
        title: 'Linear Algebra review',
        track: 'masters',
        courseId: 'c1',
        status: 'completed',
      }),
      task({ id: 'paused', title: 'Networks', track: 'university', status: 'paused' }),
      task({
        id: 'stale-running',
        title: 'Training video',
        track: 'course',
        status: 'in_progress',
      }),
    ]
    expect(
      filterEducationTasks(rows, {
        track: 'all',
        courseId: 'all',
        status: 'open',
        query: '',
      }).map((entry) => entry.id)
    ).toEqual(['open-masters', 'paused', 'stale-running'])

    expect(
      filterEducationTasks(rows, {
        track: 'masters',
        courseId: 'c1',
        status: 'all',
        query: 'algebra',
      }).map((entry) => entry.id)
    ).toEqual(['open-masters', 'done-masters'])

    expect(
      filterEducationTasks(rows, {
        track: 'all',
        courseId: 'all',
        status: 'paused',
        query: 'network',
      }).map((entry) => entry.id)
    ).toEqual(['paused'])
  })

  it('treats a stored in-progress row without a timer as paused', () => {
    const stale = task({ status: 'in_progress' })
    expect(displayTaskStatus(stale)).toBe('paused')
    const running = task({ status: 'in_progress', timerStartedAt: NOW.toISOString() })
    expect(displayTaskStatus(running)).toBe('in_progress')
  })
})

describe('education summaries', () => {
  it('uses a Saturday-first Persian week', () => {
    expect(currentWeekKeys(NOW)).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ])
  })

  it('counts today/week study seconds and per-course detail', () => {
    const runningStart = new Date(NOW_MS - 100_000).toISOString()
    const tasks = [
      task({
        id: 'done-today',
        status: 'completed',
        completedAt: NOW.toISOString(),
        dailySeconds: { [TODAY]: 600 },
      }),
      task({ id: 'paused-today', status: 'paused', dailySeconds: { [TODAY]: 300 } }),
      task({
        id: 'yesterday',
        dateKey: YESTERDAY,
        status: 'paused',
        dailySeconds: { [YESTERDAY]: 900 },
      }),
      task({
        id: 'running',
        status: 'in_progress',
        timerStartedAt: runningStart,
        dailySeconds: {},
      }),
    ]
    const items = [
      item({ id: 'active-course', status: 'active' }),
      item({ id: 'done-course', status: 'completed' }),
    ]
    const summary = summarizeEducation(tasks, items, NOW_MS)
    expect(summary.todayTasks).toBe(3)
    expect(summary.completedToday).toBe(1)
    expect(summary.remainingToday).toBe(2)
    expect(summary.studyTodaySeconds).toBe(1000)
    expect(summary.studyWeekSeconds).toBe(1900)
    expect(summary.activeCourses).toBe(1)
    expect(summary.activeTask?.id).toBe('running')

    const course = summarizeCourse(
      [
        task({ id: 'c1', courseId: 'course-1', actualSeconds: 120 }),
        task({ id: 'c2', courseId: 'course-1', actualSeconds: 30, status: 'completed' }),
        task({ id: 'other', courseId: 'course-2', actualSeconds: 999 }),
      ],
      'course-1',
      NOW_MS
    )
    expect(course).toEqual({ taskCount: 2, completedTasks: 1, studiedSeconds: 150 })
  })

  it('formats durations in hours, minutes and seconds', () => {
    expect(formatStudyDuration(0)).toBe('00:00:00')
    expect(formatStudyDuration(3661)).toBe('01:01:01')
    expect(formatStudyDuration(-5)).toBe('00:00:00')
  })

  it('shows a placeholder instead of crashing on legacy creation dates', () => {
    expect(formatEducationCreatedAt('')).toBe('—')
    expect(formatEducationCreatedAt('not-a-date')).toBe('—')
    expect(formatEducationCreatedAt(undefined)).toBe('—')
    expect(formatEducationCreatedAt('2026-11-12T08:00:00.000Z')).toMatch(/[۰-۹]+/)
  })
})

describe('study report filters', () => {
  const reports = [
    report({
      id: 'one',
      track: 'masters',
      courseId: 'c1',
      courseTitle: 'Algebra',
      createdAt: '2026-11-10T08:00:00.000Z',
      dateKey: '2026-11-10',
      summary: 'Matrix multiplication',
      topics: 'Matrices',
    }),
    report({
      id: 'two',
      track: 'university',
      courseId: 'c2',
      courseTitle: 'Networks',
      createdAt: '2026-11-12T08:00:00.000Z',
      dateKey: TODAY,
      summary: 'Routing algorithms',
      problems: 'Dijkstra proof',
    }),
    report({
      id: 'three',
      track: 'course',
      createdAt: '2026-11-11T08:00:00.000Z',
      dateKey: '2026-11-11',
      summary: 'React hooks',
      resumePoint: 'useEffect cleanup',
    }),
  ]

  it('filters by path, course, Jalali day range and free text', () => {
    expect(
      filterEducationReports(reports, {
        track: 'masters',
        courseId: 'all',
        from: '',
        to: '',
        query: '',
        sort: 'newest',
      }).map((entry) => entry.id)
    ).toEqual(['one'])

    expect(
      filterEducationReports(reports, {
        track: 'all',
        courseId: 'c2',
        from: '',
        to: '',
        query: '',
        sort: 'newest',
      }).map((entry) => entry.id)
    ).toEqual(['two'])

    expect(
      filterEducationReports(reports, {
        track: 'all',
        courseId: 'all',
        from: '2026-11-11',
        to: '2026-11-12',
        query: '',
        sort: 'newest',
      }).map((entry) => entry.id)
    ).toEqual(['two', 'three'])

    expect(
      filterEducationReports(reports, {
        track: 'all',
        courseId: 'all',
        from: '',
        to: '',
        query: 'cleanup',
        sort: 'oldest',
      }).map((entry) => entry.id)
    ).toEqual(['three'])
  })

  it('sorts newest or oldest and builds course options from snapshots', () => {
    const base = {
      track: 'all' as const,
      courseId: 'all',
      from: '',
      to: '',
      query: '',
    }
    expect(
      filterEducationReports(reports, { ...base, sort: 'oldest' }).map((entry) => entry.id)
    ).toEqual(['one', 'three', 'two'])
    expect(
      filterEducationReports(reports, { ...base, sort: 'newest' }).map((entry) => entry.id)
    ).toEqual(['two', 'three', 'one'])
    expect(reportCourseOptions(reports)).toEqual([
      { id: 'c1', title: 'Algebra' },
      { id: 'c2', title: 'Networks' },
    ])
  })

  it('counts reports per task', () => {
    expect(
      reportCountByTask([
        report({ id: 'a', taskId: 'task-1' }),
        report({ id: 'b', taskId: 'task-1' }),
        report({ id: 'c', taskId: 'task-2' }),
      ])
    ).toEqual({ 'task-1': 2, 'task-2': 1 })
  })
})
