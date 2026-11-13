import { describe, expect, it } from 'vitest'
import {
  buildUnifiedTasks,
  filterUnifiedTasks,
  sortUnifiedTasks,
  summarizeUnifiedTasks,
} from './unified-tasks'
import type { EducationTask } from '@/services/education'
import type { TimelineBlockRecord } from '@/types/timeline'
import { toDateKey } from '@/lib/date-key'

const DAY_PAST = toDateKey(new Date(2026, 0, 10))
const DAY_ONE = toDateKey(new Date(2026, 0, 15))
const DAY_TWO = toDateKey(new Date(2026, 0, 16))

function workTask(overrides: Partial<TimelineBlockRecord> = {}): TimelineBlockRecord {
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
    dateKey: DAY_ONE,
    ...overrides,
  }
}

function educationTask(overrides: Partial<EducationTask> = {}): EducationTask {
  return {
    id: 'edu-1',
    track: 'masters',
    title: 'تمرین آمار',
    priority: 'medium',
    dateKey: DAY_ONE,
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
    expect(task.dateKey).toBe(DAY_ONE)
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
    const cases: Array<[TimelineBlockRecord['status'], string | undefined, string, string]> = [
      ['planned', undefined, 'open', 'planned'],
      ['in_progress', '2026-01-15T09:05:00.000Z', 'active', 'in_progress'],
      ['in_progress', undefined, 'active', 'paused'],
      ['paused', undefined, 'active', 'paused'],
      ['completed', undefined, 'done', 'completed'],
      ['skipped', undefined, 'done', 'skipped'],
      ['rolled_over', undefined, 'open', 'rolled_over'],
    ]
    for (const [status, timerStartedAt, bucket, display] of cases) {
      const task = buildUnifiedTasks([workTask({ status, timerStartedAt })], [])[0]
      expect([task.status, task.bucket], status).toEqual([display, bucket])
    }
  })

  it('maps education tasks from every track', () => {
    const tasks = buildUnifiedTasks(
      [],
      [
        educationTask({ id: 'edu-1', track: 'masters' }),
        educationTask({ id: 'edu-2', track: 'university', courseId: 'course-1' }),
        educationTask({ id: 'edu-3', track: 'course' }),
      ]
    )
    expect(tasks.map((task) => task.track)).toEqual(['masters', 'university', 'course'])
    expect(tasks[1].courseId).toBe('course-1')
    expect(tasks[1].key).toBe('education:edu-2')
    expect(tasks[0].time).toBe('09:30')
    expect(tasks[0].estimatedMinutes).toBe(45)
  })

  it('buckets and displays every education status', () => {
    const cases: Array<[EducationTask['status'], string | undefined, string, string]> = [
      ['pending', undefined, 'open', 'pending'],
      ['in_progress', '2026-01-15T09:05:00.000Z', 'active', 'in_progress'],
      ['in_progress', undefined, 'active', 'paused'],
      ['paused', undefined, 'active', 'paused'],
      ['completed', undefined, 'done', 'completed'],
    ]
    for (const [status, timerStartedAt, bucket, display] of cases) {
      const task = buildUnifiedTasks([], [educationTask({ status, timerStartedAt })])[0]
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

describe('filterUnifiedTasks', () => {
  const tasks = buildUnifiedTasks(
    [
      workTask({ id: 'work-1', title: 'گزارش هفتگی', status: 'planned', dateKey: DAY_ONE }),
      workTask({ id: 'work-2', title: 'جلسه مشتری', status: 'completed', dateKey: DAY_PAST }),
    ],
    [
      educationTask({
        id: 'edu-1',
        title: 'تمرین آمار',
        status: 'in_progress',
        timerStartedAt: '2026-01-15T09:05:00.000Z',
        dateKey: DAY_ONE,
      }),
      educationTask({ id: 'edu-2', title: 'مرور درس', status: 'pending', dateKey: DAY_TWO }),
    ]
  )

  it('filters by source', () => {
    const workOnly = filterUnifiedTasks(
      tasks,
      { source: 'work', status: 'all', range: 'all', query: '' },
      DAY_ONE
    )
    expect(workOnly.map((task) => task.id)).toEqual(['work-1', 'work-2'])
    const educationOnly = filterUnifiedTasks(
      tasks,
      { source: 'education', status: 'all', range: 'all', query: '' },
      DAY_ONE
    )
    expect(educationOnly.map((task) => task.id)).toEqual(['edu-1', 'edu-2'])
  })

  it('filters by normalized status', () => {
    const done = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'done', range: 'all', query: '' },
      DAY_ONE
    )
    expect(done.map((task) => task.id)).toEqual(['work-2'])
    const active = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'active', range: 'all', query: '' },
      DAY_ONE
    )
    expect(active.map((task) => task.id)).toEqual(['edu-1'])
  })

  it('filters by time range', () => {
    const past = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'all', range: 'past', query: '' },
      DAY_ONE
    )
    expect(past.map((task) => task.id)).toEqual(['work-2'])
    const today = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'all', range: 'today', query: '' },
      DAY_ONE
    )
    expect(today.map((task) => task.id).sort()).toEqual(['edu-1', 'work-1'])
    const upcoming = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'all', range: 'upcoming', query: '' },
      DAY_ONE
    )
    expect(upcoming.map((task) => task.id)).toEqual(['edu-2'])
  })

  it('searches titles case-insensitively', () => {
    const found = filterUnifiedTasks(
      tasks,
      { source: 'all', status: 'all', range: 'all', query: 'آمار' },
      DAY_ONE
    )
    expect(found.map((task) => task.id)).toEqual(['edu-1'])
    expect(
      filterUnifiedTasks(
        tasks,
        { source: 'all', status: 'all', range: 'all', query: 'گزارش' },
        DAY_ONE
      ).map((task) => task.id)
    ).toEqual(['work-1'])
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
        dateKey: DAY_ONE,
        startTime: new Date(2026, 0, 15, 8, 0).toISOString(),
      }),
      workTask({
        id: 'open-medium-late',
        title: 'باز متوسط',
        status: 'planned',
        priority: 'medium',
        dateKey: DAY_ONE,
        startTime: new Date(2026, 0, 15, 10, 0).toISOString(),
      }),
      workTask({
        id: 'open-medium-early',
        title: 'باز متوسط زود',
        status: 'planned',
        priority: 'medium',
        dateKey: DAY_ONE,
        startTime: new Date(2026, 0, 15, 9, 0).toISOString(),
      }),
      workTask({
        id: 'active-high',
        title: 'در حال انجام زیاد',
        status: 'in_progress',
        timerStartedAt: '2026-01-15T09:05:00.000Z',
        priority: 'high',
        dateKey: DAY_ONE,
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
      [educationTask({ id: 'edu-early', time: '07:45', dateKey: DAY_TWO })]
    )
    const sorted = sortUnifiedTasks([...tasks, ...extra], 'time').map((task) => task.id)
    expect(sorted[0]).toBe('edu-early')
  })
})

describe('summarizeUnifiedTasks', () => {
  it('counts total, completed and remaining across both sources', () => {
    const tasks = buildUnifiedTasks(
      [workTask({ status: 'planned' }), workTask({ status: 'completed' }), workTask({ status: 'skipped' })],
      [educationTask({ status: 'pending' }), educationTask({ status: 'in_progress' })]
    )
    expect(summarizeUnifiedTasks(tasks)).toEqual({
      total: 5,
      completed: 2,
      remaining: 3,
    })
  })
})
