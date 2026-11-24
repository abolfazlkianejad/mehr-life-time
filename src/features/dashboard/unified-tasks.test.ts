import type { TimelineBlockRecord } from '@/types/timeline'
import { describe, expect, it } from 'vitest'
import type { EducationTask } from '@/services/education'
import {
  buildUnifiedTasks,
  filterUnifiedTasks,
  isDayKey,
  sortUnifiedTasks,
  summarizeUnifiedTasks,
  DEFAULT_UNIFIED_TASK_FILTERS,
  type UnifiedTaskFilters,
} from './unified-tasks'

/** Thursday 2026-01-15; its Saturday-first week is 2026-01-10 … 2026-01-16. */
const TODAY = '2026-01-15'
const YESTERDAY = '2026-01-14'
const WEEK_START = '2026-01-10'
const LAST_WEEK_DAY = '2026-01-05'
const NEXT_WEEK_DAY = '2026-01-17'
const LONG_AGO = '2025-11-01'

const filters = (
  patch: Partial<UnifiedTaskFilters> = {}
): UnifiedTaskFilters => ({
  ...DEFAULT_UNIFIED_TASK_FILTERS,
  ...patch,
})

function workTask(
  overrides: Partial<TimelineBlockRecord> = {}
): TimelineBlockRecord {
  return {
    id: 'work-1',
    title: 'تهیه گزارش',
    category: 'work',
    startTime: new Date(2026, 0, 15, 9, 0).toISOString(),
    endTime: new Date(2026, 0, 15, 10, 0).toISOString(),
    durationMinutes: 60,
    energyLevelRequired: 3,
    status: 'planned',
    isConflictFree: true,
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    dateKey: TODAY,
    ...overrides,
  }
}

function educationTask(overrides: Partial<EducationTask> = {}): EducationTask {
  return {
    id: 'edu-1',
    track: 'masters',
    title: 'تمرین آمار',
    priority: 'medium',
    dateKey: TODAY,
    time: '09:30',
    estimatedMinutes: 45,
    status: 'pending',
    actualSeconds: 0,
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('buildUnifiedTasks', () => {
  it('maps work tasks with schedule, priority and bucket', () => {
    const tasks = buildUnifiedTasks([workTask({ priority: 'high' })], [])
    expect(tasks).toHaveLength(1)
    const task = tasks[0]
    expect(task.key).toBe('work:work-1')
    expect(task.source).toBe('work')
    expect(task.time).toBe('09:00')
    expect(task.dateKey).toBe(TODAY)
    expect(task.estimatedMinutes).toBe(60)
    expect(task.priority).toBe('high')
    expect(task.bucket).toBe('open')
    expect(task.status).toBe('planned')
  })

  it('defaults the priority of legacy work records to medium', () => {
    const tasks = buildUnifiedTasks([workTask({ priority: undefined })], [])
    expect(tasks[0].priority).toBe('medium')
  })

  it('buckets and displays every work status', () => {
    const cases: Array<
      [TimelineBlockRecord['status'], string | undefined, string, string]
    > = [
      ['planned', undefined, 'open', 'planned'],
      ['in_progress', '2026-01-15T09:05:00.000Z', 'active', 'in_progress'],
      ['in_progress', undefined, 'active', 'paused'],
      ['paused', undefined, 'active', 'paused'],
      ['completed', undefined, 'done', 'completed'],
      ['skipped', undefined, 'done', 'skipped'],
      ['rolled_over', undefined, 'open', 'rolled_over'],
    ]
    for (const [status, timerStartedAt, bucket, display] of cases) {
      const task = buildUnifiedTasks(
        [workTask({ status, timerStartedAt })],
        []
      )[0]
      expect([task.status, task.bucket], status).toEqual([display, bucket])
    }
  })

  it('maps education tasks from every track', () => {
    const tasks = buildUnifiedTasks(
      [],
      [
        educationTask({ id: 'edu-1', track: 'masters' }),
        educationTask({
          id: 'edu-2',
          track: 'university',
          courseId: 'course-1',
        }),
        educationTask({ id: 'edu-3', track: 'course' }),
      ]
    )
    expect(tasks.map((task) => task.track)).toEqual([
      'masters',
      'university',
      'course',
    ])
    expect(tasks[1].courseId).toBe('course-1')
    expect(tasks[1].key).toBe('education:edu-2')
    expect(tasks[0].time).toBe('09:30')
    expect(tasks[0].estimatedMinutes).toBe(45)
  })

  it('buckets and displays every education status', () => {
    const cases: Array<
      [EducationTask['status'], string | undefined, string, string]
    > = [
      ['pending', undefined, 'open', 'pending'],
      ['in_progress', '2026-01-15T09:05:00.000Z', 'active', 'in_progress'],
      ['in_progress', undefined, 'active', 'paused'],
      ['paused', undefined, 'active', 'paused'],
      ['completed', undefined, 'done', 'completed'],
    ]
    for (const [status, timerStartedAt, bucket, display] of cases) {
      const task = buildUnifiedTasks(
        [],
        [educationTask({ status, timerStartedAt })]
      )[0]
      expect([task.status, task.bucket], status).toEqual([display, bucket])
    }
  })

  it('keeps module fields apart and never fabricates values', () => {
    const work = buildUnifiedTasks([workTask()], [])[0]
    const education = buildUnifiedTasks([], [educationTask()])[0]
    expect('track' in work).toBe(false)
    expect('courseId' in work).toBe(false)
    expect('description' in work).toBe(false)
    expect('category' in education).toBe(false)
    expect('isCompanyWork' in education).toBe(false)
    expect('notes' in education).toBe(false)
    expect('elapsedSeconds' in work).toBe(false)
  })
})

describe('isDayKey', () => {
  it('accepts stored day keys only', () => {
    expect(isDayKey(TODAY)).toBe(true)
    expect(isDayKey('2026-1-5')).toBe(false)
    expect(isDayKey('')).toBe(false)
    expect(isDayKey(null)).toBe(false)
    expect(isDayKey(20260115)).toBe(false)
  })
})

describe('filterUnifiedTasks', () => {
  const tasks = buildUnifiedTasks(
    [
      workTask({
        id: 'work-today',
        title: 'گزارش هفتگی',
        status: 'planned',
        dateKey: TODAY,
      }),
      workTask({
        id: 'work-yesterday',
        title: 'جلسه مشتری',
        status: 'completed',
        dateKey: YESTERDAY,
      }),
      workTask({
        id: 'work-week',
        title: 'پیگیری پروژه',
        status: 'paused',
        dateKey: WEEK_START,
      }),
      workTask({
        id: 'work-next',
        title: 'برنامه آینده',
        dateKey: NEXT_WEEK_DAY,
      }),
      workTask({ id: 'work-old', title: 'کار قدیمی', dateKey: LONG_AGO }),
    ],
    [
      educationTask({
        id: 'edu-today',
        title: 'تمرین آمار',
        status: 'in_progress',
        timerStartedAt: '2026-01-15T09:05:00.000Z',
        dateKey: TODAY,
      }),
      educationTask({
        id: 'edu-last-week',
        title: 'مرور درس',
        dateKey: LAST_WEEK_DAY,
      }),
    ]
  )

  const ids = (patch: Partial<UnifiedTaskFilters> = {}) =>
    filterUnifiedTasks(tasks, filters(patch)).map((task) => task.id)

  it('filters by source', () => {
    expect(ids({ source: 'work' })).toEqual([
      'work-today',
      'work-yesterday',
      'work-week',
      'work-next',
      'work-old',
    ])
    expect(ids({ source: 'education' })).toEqual(['edu-today', 'edu-last-week'])
  })

  it('filters by the five status buckets', () => {
    expect(ids({ status: 'done' })).toEqual(['work-yesterday'])
    expect(ids({ status: 'active' })).toEqual(['edu-today'])
    expect(ids({ status: 'paused' })).toEqual(['work-week'])
    expect(ids({ status: 'open' })).toEqual([
      'work-today',
      'work-next',
      'work-old',
      'edu-last-week',
    ])
  })

  it('keeps only the exact selected day', () => {
    expect(ids({ dateKey: TODAY })).toEqual(['work-today', 'edu-today'])
    expect(ids({ dateKey: YESTERDAY })).toEqual(['work-yesterday'])
  })

  it('shows past and future days without leaking neighbours', () => {
    expect(ids({ dateKey: NEXT_WEEK_DAY })).toEqual(['work-next'])
    expect(ids({ dateKey: LONG_AGO })).toEqual(['work-old'])
    expect(ids({ dateKey: '2026-01-16' })).toEqual([])
  })

  it('compares the stored key, never a range around it', () => {
    const selected = ids({ dateKey: WEEK_START })
    expect(selected).toEqual(['work-week'])
    expect(selected).not.toContain('work-today')
    expect(selected).not.toContain('edu-last-week')
  })

  it('disables the date restriction for an empty or malformed key', () => {
    expect(ids({ dateKey: '' })).toHaveLength(7)
    expect(ids({ dateKey: 'not-a-day' })).toHaveLength(7)
  })

  it('combines the selected day with status and source', () => {
    expect(ids({ dateKey: TODAY, status: 'open', source: 'work' })).toEqual([
      'work-today',
    ])
    expect(ids({ dateKey: TODAY, status: 'open' })).toEqual(['work-today'])
  })

  it('filters by priority and project', () => {
    const tagged = buildUnifiedTasks(
      [
        workTask({ id: 'p1', projectId: 'project-1', priority: 'urgent' }),
        workTask({ id: 'p2', projectId: 'project-2', priority: 'low' }),
      ],
      [educationTask({ id: 'e1', priority: 'high' })]
    )
    expect(
      filterUnifiedTasks(tagged, filters({ priority: 'urgent' })).map(
        (task) => task.id
      )
    ).toEqual(['p1'])
    expect(
      filterUnifiedTasks(tagged, filters({ priority: 'high' })).map(
        (task) => task.id
      )
    ).toEqual(['e1'])
    expect(
      filterUnifiedTasks(tagged, filters({ projectId: 'project-2' })).map(
        (task) => task.id
      )
    ).toEqual(['p2'])
  })

  it('searches titles case-insensitively', () => {
    expect(ids({ query: 'آمار' })).toEqual(['edu-today'])
    expect(ids({ query: 'گزارش' })).toEqual(['work-today'])
    expect(ids({ dateKey: YESTERDAY, query: 'آمار' })).toEqual([])
  })
})

describe('sortUnifiedTasks', () => {
  const tasks = buildUnifiedTasks(
    [
      workTask({
        id: 'done-urgent',
        title: 'انجام‌شده فوری',
        status: 'completed',
        priority: 'urgent',
        dateKey: TODAY,
        startTime: new Date(2026, 0, 15, 8, 0).toISOString(),
      }),
      workTask({
        id: 'open-medium-late',
        title: 'باز متوسط',
        status: 'planned',
        priority: 'medium',
        dateKey: TODAY,
        startTime: new Date(2026, 0, 15, 10, 0).toISOString(),
      }),
      workTask({
        id: 'open-medium-early',
        title: 'باز متوسط زود',
        status: 'planned',
        priority: 'medium',
        dateKey: TODAY,
        startTime: new Date(2026, 0, 15, 9, 0).toISOString(),
      }),
      workTask({
        id: 'active-high',
        title: 'در حال انجام زیاد',
        status: 'in_progress',
        timerStartedAt: '2026-01-15T09:05:00.000Z',
        priority: 'high',
        dateKey: TODAY,
        startTime: new Date(2026, 0, 15, 8, 30).toISOString(),
      }),
    ],
    []
  )

  it('smart: open and active first, then priority, then date and time', () => {
    const sorted = sortUnifiedTasks(tasks, 'smart').map((task) => task.id)
    expect(sorted).toEqual([
      'active-high',
      'open-medium-early',
      'open-medium-late',
      'done-urgent',
    ])
  })

  it('priority: urgent first, then schedule', () => {
    const sorted = sortUnifiedTasks(tasks, 'priority').map((task) => task.id)
    expect(sorted).toEqual([
      'done-urgent',
      'active-high',
      'open-medium-early',
      'open-medium-late',
    ])
  })

  it('date: planned schedule first, then priority', () => {
    const sorted = sortUnifiedTasks(tasks, 'date').map((task) => task.id)
    expect(sorted).toEqual([
      'done-urgent',
      'active-high',
      'open-medium-early',
      'open-medium-late',
    ])
  })

  it('time: earliest start time first across dates', () => {
    const extra = buildUnifiedTasks(
      [],
      [
        educationTask({
          id: 'edu-early',
          time: '07:45',
          dateKey: NEXT_WEEK_DAY,
        }),
      ]
    )
    const sorted = sortUnifiedTasks([...tasks, ...extra], 'time').map(
      (task) => task.id
    )
    expect(sorted[0]).toBe('edu-early')
  })
})

describe('summarizeUnifiedTasks', () => {
  it('counts total, completed and remaining across both sources', () => {
    const tasks = buildUnifiedTasks(
      [
        workTask({ status: 'planned' }),
        workTask({ status: 'completed' }),
        workTask({ status: 'skipped' }),
      ],
      [
        educationTask({ status: 'pending' }),
        educationTask({ status: 'in_progress' }),
      ]
    )
    expect(summarizeUnifiedTasks(tasks)).toEqual({
      total: 5,
      completed: 2,
      remaining: 3,
    })
  })
})
