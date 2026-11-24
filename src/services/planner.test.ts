import { beforeEach, describe, expect, it } from 'vitest'
import {
  DB_VERSION,
  destroyDatabase,
  initializeOfflineStorage,
  saveTimelineBlock,
} from '@/services/db'
import {
  finishEducationTaskTimer,
  getEducationTasks,
  saveEducationTask,
  startEducationTaskTimer,
  type EducationTaskInput,
} from '@/services/education'
import { deleteDatabase } from '@/services/idb'
import {
  collectBusyIntervals,
  createPlannerTask,
  createWeekPlan,
  deletePlannerItem,
  expandAvailabilityBlocks,
  getAvailabilityReport,
  getPlannerAvailability,
  getPlannerContext,
  getPlannerTasks,
  getStudyPaths,
  getWeekPlan,
  listFreeSlots,
  overlapsInterval,
  PlannerError,
  reschedulePlannerTask,
  savePlannerAvailability,
  updateWeekPlan,
  type PlannerAvailabilityInput,
} from '@/services/planner'

// 2026-01-15 is a Thursday (weekday 5), 2026-01-16 a Friday (6),
// 2026-01-17 a Saturday (0) and 2026-01-18 a Sunday (1).
const THURSDAY = '2026-01-15'
const FRIDAY = '2026-01-16'
const SATURDAY = '2026-01-17'
const SUNDAY = '2026-01-18'
const NOW = new Date('2026-01-18T12:00:00')

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage()
}

async function seedTimelineBlock(input: {
  title: string
  category: 'work' | 'study' | 'workout' | 'buffer' | 'sleep'
  dateKey: string
  startClock: string
  minutes: number
  status?:
    | 'planned'
    | 'in_progress'
    | 'paused'
    | 'rolled_over'
    | 'completed'
    | 'skipped'
}) {
  const start = new Date(`${input.dateKey}T${input.startClock}:00`)
  return saveTimelineBlock({
    title: input.title,
    category: input.category,
    startTime: start,
    endTime: new Date(start.getTime() + input.minutes * 60_000),
    durationMinutes: input.minutes,
    energyLevelRequired: 3,
    status: input.status ?? 'planned',
  })
}

async function seedTask(input: EducationTaskInput) {
  return saveEducationTask(input)
}

function busyBlock(
  overrides: Partial<PlannerAvailabilityInput> = {}
): PlannerAvailabilityInput {
  return {
    kind: 'busy',
    title: 'دانشگاه',
    dateKey: SATURDAY,
    startClock: '08:00',
    endClock: '12:00',
    ...overrides,
  }
}

describe('planner availability', () => {
  beforeEach(freshDatabase)

  it('validates blocks strictly', async () => {
    await expect(
      savePlannerAvailability([{ ...busyBlock(), endClock: '07:00' }])
    ).rejects.toThrow(PlannerError)
    await expect(
      savePlannerAvailability([{ ...busyBlock(), weekday: 0 }])
    ).rejects.toThrow(PlannerError)
    await expect(
      savePlannerAvailability([
        {
          kind: 'busy',
          title: 'بدون روز',
          startClock: '08:00',
          endClock: '12:00',
        },
      ])
    ).rejects.toThrow(PlannerError)
    await expect(
      savePlannerAvailability([
        { ...busyBlock(), kind: 'sometimes' as unknown as 'busy' },
      ])
    ).rejects.toThrow(PlannerError)
    await expect(
      savePlannerAvailability([{ ...busyBlock(), startClock: '25:00' }])
    ).rejects.toThrow(PlannerError)
    await expect(
      savePlannerAvailability([
        {
          kind: 'busy',
          title: 'آخر هفته',
          weekday: 7,
          startClock: '08:00',
          endClock: '12:00',
        },
      ])
    ).rejects.toThrow(PlannerError)
  })

  it('saves, reads and upserts blocks by id', async () => {
    const first = await savePlannerAvailability([busyBlock()])
    const saved = first.saved[0] as NonNullable<(typeof first.saved)[number]>
    const again = await savePlannerAvailability([
      { id: saved.id, ...busyBlock(), kind: 'free' },
    ])
    expect(again.saved).toHaveLength(1)
    expect(again.saved[0]?.id).toBe(saved.id)
    expect(again.saved[0]?.createdAt).toBe(saved.createdAt)
    expect(again.saved[0]?.kind).toBe('free')
    expect(await getPlannerAvailability()).toHaveLength(1)
  })

  it('is idempotent for a repeated requestId', async () => {
    const first = await savePlannerAvailability([busyBlock()], 'req-avail')
    const second = await savePlannerAvailability([busyBlock()], 'req-avail')
    expect(first.saved).toHaveLength(1)
    expect(second.duplicate).toBe(true)
    expect(await getPlannerAvailability()).toHaveLength(1)
  })

  it('expands recurring weekday blocks on every matching day', async () => {
    await savePlannerAvailability([
      {
        kind: 'busy',
        title: 'دانشگاه',
        weekday: 0,
        startClock: '08:00',
        endClock: '12:00',
      },
    ])
    const intervals = expandAvailabilityBlocks(
      SATURDAY,
      '2026-01-24',
      await getPlannerAvailability(),
      'busy'
    )
    // Two Saturdays in the range: 2026-01-17 and 2026-01-24.
    expect(intervals).toHaveLength(2)
    expect(intervals[0]?.startTime).toBe(
      new Date(`${SATURDAY}T08:00:00`).toISOString()
    )
    expect(intervals[1]?.startTime).toBe(
      new Date('2026-01-24T08:00:00').toISOString()
    )
  })

  it('expands one-off blocks only on their own day', async () => {
    await savePlannerAvailability([
      {
        kind: 'busy',
        title: 'جلسه',
        dateKey: THURSDAY,
        startClock: '15:00',
        endClock: '16:00',
      },
    ])
    const intervals = expandAvailabilityBlocks(
      SATURDAY,
      SUNDAY,
      await getPlannerAvailability(),
      'busy'
    )
    expect(intervals).toHaveLength(0)
  })
})

describe('planner busy intervals', () => {
  beforeEach(freshDatabase)

  it('collects active timeline blocks, open tasks and declared busy windows', async () => {
    await seedTimelineBlock({
      title: 'باشگاه',
      category: 'workout',
      dateKey: SATURDAY,
      startClock: '18:00',
      minutes: 120,
    })
    await seedTimelineBlock({
      title: 'تمام‌شده',
      category: 'study',
      dateKey: SATURDAY,
      startClock: '09:00',
      minutes: 60,
      status: 'completed',
    })
    await seedTask({
      track: 'masters',
      title: 'مرور ریاضی',
      priority: 'high',
      dateKey: SATURDAY,
      time: '14:00',
      estimatedMinutes: 90,
    })
    await seedTask({
      track: 'masters',
      title: 'تسک کامل‌شده',
      priority: 'low',
      dateKey: SATURDAY,
      time: '16:00',
      estimatedMinutes: 30,
      status: 'completed',
    })
    await savePlannerAvailability([busyBlock()])

    const busy = await collectBusyIntervals(SATURDAY, SUNDAY)
    expect(busy).toHaveLength(3)
    expect(busy.map((item) => item.source).sort()).toEqual([
      'availability',
      'education',
      'timeline',
    ])
  })
})

describe('planner free slots', () => {
  beforeEach(freshDatabase)

  it('removes the protected lunch hour from every day', async () => {
    const report = await getAvailabilityReport(SATURDAY, SATURDAY)
    expect(report.freeSlots).toHaveLength(2)
    expect(report.freeSlots[0]?.minutes).toBe(300)
    expect(report.freeSlots[1]?.minutes).toBe(420)
    expect(report.capacity.totalFreeMinutes).toBe(720)
    expect(report.capacity.byDay[SATURDAY]).toBe(720)
  })

  it('splits slots around busy intervals', async () => {
    await seedTimelineBlock({
      title: 'کلاس',
      category: 'study',
      dateKey: SATURDAY,
      startClock: '10:00',
      minutes: 120,
    })
    const slots = listFreeSlots(
      SATURDAY,
      SATURDAY,
      await collectBusyIntervals(SATURDAY, SATURDAY)
    )
    expect(slots.map((slot) => slot.minutes)).toEqual([120, 60, 420])
  })

  it('drops windows shorter than minSlotMinutes', async () => {
    await seedTimelineBlock({
      title: 'کلاس',
      category: 'study',
      dateKey: SATURDAY,
      startClock: '10:00',
      minutes: 120,
    })
    const slots = listFreeSlots(
      SATURDAY,
      SATURDAY,
      await collectBusyIntervals(SATURDAY, SATURDAY),
      {
        minSlotMinutes: 90,
      }
    )
    expect(slots.map((slot) => slot.minutes)).toEqual([120, 420])
  })

  it('keeps lunch free when protection is disabled', async () => {
    const report = await getAvailabilityReport(SATURDAY, SATURDAY, {
      protectLunch: false,
    })
    expect(report.freeSlots).toHaveLength(1)
    expect(report.freeSlots[0]?.minutes).toBe(780)
  })

  it('detects interval overlap', () => {
    const morning = {
      startTime: '2026-01-17T08:00:00.000Z',
      endTime: '2026-01-17T12:00:00.000Z',
    }
    const later = {
      startTime: '2026-01-17T12:00:00.000Z',
      endTime: '2026-01-17T14:00:00.000Z',
    }
    const inside = {
      startTime: '2026-01-17T09:00:00.000Z',
      endTime: '2026-01-17T10:00:00.000Z',
    }
    expect(overlapsInterval(morning, later)).toBe(false)
    expect(overlapsInterval(morning, inside)).toBe(true)
  })
})

describe('create week plan', () => {
  beforeEach(freshDatabase)

  it('creates tasks for all three paths inside free slots', async () => {
    await savePlannerAvailability([busyBlock()])
    const result = await createWeekPlan(
      [
        {
          track: 'masters',
          title: 'ریاضی مهندسی',
          priority: 'high',
          dateKey: SATURDAY,
          time: '14:00',
          estimatedMinutes: 90,
        },
        {
          track: 'university',
          title: 'تمرین شبکه',
          priority: 'medium',
          dateKey: SATURDAY,
          time: '16:00',
          estimatedMinutes: 60,
        },
        {
          track: 'course',
          title: 'جلسه هوش مصنوعی',
          priority: 'medium',
          dateKey: SUNDAY,
          time: '09:00',
          estimatedMinutes: 120,
        },
      ],
      'req-plan'
    )
    expect(result.created).toHaveLength(3)
    expect(result.failed).toHaveLength(0)
    const tasks = await getEducationTasks()
    expect(tasks).toHaveLength(3)
    expect(tasks.every((task) => task.plannerManaged === true)).toBe(true)
    expect(await getWeekPlan(SATURDAY, SUNDAY)).toHaveLength(3)
  })

  it('rejects entries inside a declared busy window', async () => {
    await savePlannerAvailability([busyBlock()])
    const result = await createWeekPlan([
      {
        track: 'masters',
        title: 'درس دانشگاهی',
        priority: 'high',
        dateKey: SATURDAY,
        time: '08:30',
        estimatedMinutes: 60,
      },
    ])
    expect(result.created).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.code).toBe('conflict')
    expect(result.failed[0]?.message).toContain('دانشگاه')
  })

  it('rejects overlap with an existing user-created task', async () => {
    await seedTask({
      track: 'university',
      title: 'مطالعه شخصی',
      priority: 'medium',
      dateKey: SATURDAY,
      time: '15:00',
      estimatedMinutes: 60,
    })
    const result = await createWeekPlan([
      {
        track: 'masters',
        title: 'مرور',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '15:30',
        estimatedMinutes: 60,
      },
    ])
    expect(result.failed[0]?.code).toBe('conflict')
  })

  it('rejects overlap between two entries of the same batch', async () => {
    const result = await createWeekPlan([
      {
        track: 'masters',
        title: 'اول',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '10:00',
        estimatedMinutes: 60,
      },
      {
        track: 'course',
        title: 'دوم',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '10:30',
        estimatedMinutes: 60,
      },
    ])
    expect(result.created).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.code).toBe('conflict')
  })

  it('reports invalid entries per index and keeps the valid ones', async () => {
    const result = await createWeekPlan([
      {
        track: 'masters',
        title: 'معتبر',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '10:00',
        estimatedMinutes: 60,
      },
      {
        track: 'unknown' as never,
        title: 'نامعتبر',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '11:00',
        estimatedMinutes: 60,
      },
    ])
    expect(result.created).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.index).toBe(1)
    expect(result.failed[0]?.code).toBe('invalid_args')
  })

  it('is idempotent for a repeated requestId', async () => {
    await createWeekPlan(
      [
        {
          track: 'masters',
          title: 'ریاضی',
          priority: 'high',
          dateKey: SATURDAY,
          time: '14:00',
          estimatedMinutes: 90,
        },
      ],
      'req-plan-2'
    )
    const repeated = await createWeekPlan(
      [
        {
          track: 'masters',
          title: 'ریاضی',
          priority: 'high',
          dateKey: SATURDAY,
          time: '14:00',
          estimatedMinutes: 90,
        },
      ],
      'req-plan-2'
    )
    expect(repeated.duplicate).toBe(true)
    expect(await getEducationTasks()).toHaveLength(1)
  })

  it('upserts entries that carry a stable client id', async () => {
    const entry = {
      id: 'stable-plan-entry',
      track: 'course' as const,
      title: 'ویدیو اول',
      priority: 'medium' as const,
      dateKey: SATURDAY,
      time: '14:00',
      estimatedMinutes: 45,
    }
    await createWeekPlan([entry])
    await createWeekPlan([{ ...entry, title: 'ویدیو اول — ویرایش‌شده' }])
    const tasks = await getEducationTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('ویدیو اول — ویرایش‌شده')
  })
})

describe('create planner task', () => {
  beforeEach(freshDatabase)

  it('creates a single task with a plannerManaged flag', async () => {
    const { created } = await createPlannerTask({
      track: 'masters',
      title: 'تست تک‌تسکی',
      priority: 'low',
      dateKey: SUNDAY,
      time: '10:00',
      estimatedMinutes: 30,
    })
    expect(created.plannerManaged).toBe(true)
    expect(created.dateKey).toBe(SUNDAY)
  })

  it('throws a structured conflict error', async () => {
    await savePlannerAvailability([busyBlock()])
    await expect(
      createPlannerTask({
        track: 'masters',
        title: 'متضاد',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '09:00',
        estimatedMinutes: 30,
      })
    ).rejects.toMatchObject({ name: 'PlannerError', code: 'conflict' })
  })
})

describe('update and reschedule', () => {
  beforeEach(freshDatabase)

  it('moves a task to a free time', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'مرور',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 60,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    const result = await updateWeekPlan([
      { id: task.id, patch: { time: '15:00', dateKey: SUNDAY } },
    ])
    expect(result.updated).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    expect(result.updated[0]?.time).toBe('15:00')
    expect(result.updated[0]?.dateKey).toBe(SUNDAY)
  })

  it('rejects a move that lands on another task', async () => {
    const other = await seedTask({
      track: 'course',
      title: 'جای اشغال',
      priority: 'medium',
      dateKey: SUNDAY,
      time: '10:00',
      estimatedMinutes: 60,
    })
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'مرور',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 60,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    const result = await updateWeekPlan([
      { id: task.id, patch: { dateKey: SUNDAY, time: '10:30' } },
    ])
    expect(result.updated).toHaveLength(0)
    expect(result.failed[0]?.code).toBe('conflict')
    expect((await getEducationTaskUnchanged(other.id))?.dateKey).toBe(SUNDAY)
  })

  it('lets a task move by sliding over its own old window', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'شیفت کوچک',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 60,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    const result = await updateWeekPlan([
      { id: task.id, patch: { time: '14:30' } },
    ])
    expect(result.updated).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it('rejects rescheduling a completed task', async () => {
    const task = await seedTask({
      track: 'masters',
      title: 'تمام‌شده',
      priority: 'medium',
      dateKey: SATURDAY,
      time: '14:00',
      estimatedMinutes: 30,
    })
    await finishEducationTaskTimer(task.id)
    const result = await updateWeekPlan([
      { id: task.id, patch: { time: '16:00' } },
    ])
    expect(result.failed[0]?.code).toBe('invalid_args')
  })

  it('rejects rescheduling a task with a running timer', async () => {
    const task = await seedTask({
      track: 'masters',
      title: 'در حال مطالعه',
      priority: 'medium',
      dateKey: SATURDAY,
      time: '14:00',
      estimatedMinutes: 30,
    })
    await startEducationTaskTimer(task.id)
    const result = await updateWeekPlan([
      { id: task.id, patch: { time: '16:00' } },
    ])
    expect(result.failed[0]?.code).toBe('busy_timer')
  })

  it('reports missing tasks as not_found', async () => {
    const result = await updateWeekPlan([
      { id: 'missing-task', patch: { time: '16:00' } },
    ])
    expect(result.failed[0]?.code).toBe('not_found')
  })

  it('reschedules a task through the dedicated helper', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'جابه‌جایی',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 60,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    const { updated } = await reschedulePlannerTask(task.id, {
      dateKey: FRIDAY,
      time: '18:00',
    })
    expect(updated.dateKey).toBe(FRIDAY)
    expect(updated.time).toBe('18:00')
  })

  it('throws a structured error when the dedicated reschedule conflicts', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'جابه‌جایی',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 60,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    await savePlannerAvailability([busyBlock()])
    await expect(
      reschedulePlannerTask(task.id, { dateKey: SATURDAY, time: '08:30' })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('delete planner item', () => {
  beforeEach(freshDatabase)

  it('deletes a planner-created task', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'قابل حذف',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 30,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    const { deleted } = await deletePlannerItem('task', task.id)
    expect(deleted.id).toBe(task.id)
    expect(await getEducationTasks()).toHaveLength(0)
  })

  it('refuses to delete a task the planner did not create', async () => {
    const task = await seedTask({
      track: 'masters',
      title: 'تسک دستی',
      priority: 'medium',
      dateKey: SATURDAY,
      time: '14:00',
      estimatedMinutes: 30,
    })
    await expect(deletePlannerItem('task', task.id)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(await getEducationTasks()).toHaveLength(1)
  })

  it('reports a missing task as not_found', async () => {
    await expect(deletePlannerItem('task', 'missing')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('refuses to delete a task with a running timer', async () => {
    const plan = await createWeekPlan([
      {
        track: 'masters',
        title: 'در حال مطالعه',
        priority: 'medium',
        dateKey: SATURDAY,
        time: '14:00',
        estimatedMinutes: 30,
      },
    ])
    const task = plan.created[0] as NonNullable<(typeof plan.created)[number]>
    await startEducationTaskTimer(task.id)
    await expect(deletePlannerItem('task', task.id)).rejects.toMatchObject({
      code: 'busy_timer',
    })
  })

  it('deletes availability blocks and rejects unknown kinds', async () => {
    const saved = await savePlannerAvailability([busyBlock()])
    const block = saved.saved[0] as NonNullable<(typeof saved.saved)[number]>
    await deletePlannerItem('availability', block.id)
    expect(await getPlannerAvailability()).toHaveLength(0)
    await expect(
      deletePlannerItem('something' as never, block.id)
    ).rejects.toMatchObject({ code: 'invalid_args' })
  })
})

describe('planner task reads', () => {
  beforeEach(freshDatabase)

  it('flags overdue education tasks and work blocks', async () => {
    await seedTask({
      track: 'masters',
      title: 'عقب‌افتاده',
      priority: 'high',
      dateKey: SATURDAY,
      time: '09:00',
      estimatedMinutes: 60,
    })
    await seedTask({
      track: 'masters',
      title: 'امروز',
      priority: 'low',
      dateKey: SUNDAY,
      time: '09:00',
      estimatedMinutes: 60,
    })
    await seedTimelineBlock({
      title: 'کار عقب‌افتاده',
      category: 'work',
      dateKey: SATURDAY,
      startClock: '09:00',
      minutes: 60,
    })

    const overdue = await getPlannerTasks({ overdue: true }, NOW)
    expect(overdue).toHaveLength(2)
    expect(overdue.every((item) => item.overdue)).toBe(true)

    const masters = await getPlannerTasks({ track: 'masters' }, NOW)
    expect(masters).toHaveLength(2)
    expect(masters.every((item) => item.kind === 'education')).toBe(true)

    const all = await getPlannerTasks({}, NOW)
    expect(all).toHaveLength(3)
    const workEntry = all.find((item) => item.kind === 'work')
    expect(workEntry?.time).toBe('09:00')
    expect(workEntry?.estimatedMinutes).toBe(60)
  })

  it('returns study path statistics for the three tracks', async () => {
    await seedTask({
      track: 'masters',
      title: 'باز',
      priority: 'medium',
      dateKey: SUNDAY,
      time: '09:00',
      estimatedMinutes: 60,
    })
    await seedTask({
      track: 'masters',
      title: 'کامل',
      priority: 'medium',
      dateKey: SUNDAY,
      time: '10:00',
      estimatedMinutes: 60,
      status: 'completed',
    })
    const paths = await getStudyPaths(NOW)
    expect(paths.map((path) => path.track)).toEqual([
      'masters',
      'university',
      'course',
    ])
    const masters = paths.find((path) => path.track === 'masters')
    expect(masters?.openTasks).toBe(1)
    expect(masters?.completedTasks).toBe(1)
    expect(masters?.scheduledMinutes).toBe(60)
    expect(paths.every((path) => path.items !== undefined)).toBe(true)
  })

  it('aggregates the planner context in one call', async () => {
    await savePlannerAvailability([busyBlock()])
    await createWeekPlan([
      {
        track: 'masters',
        title: 'ریاضی',
        priority: 'high',
        dateKey: SUNDAY,
        time: '14:00',
        estimatedMinutes: 90,
      },
    ])
    const context = await getPlannerContext({
      from: SATURDAY,
      to: SUNDAY,
      now: NOW,
    })
    expect(context.todayKey).toBe(SUNDAY)
    expect(context.weekPlan).toHaveLength(1)
    expect(context.openTasks).toHaveLength(1)
    expect(context.overdueTasks).toHaveLength(0)
    expect(context.studyPaths).toHaveLength(3)
    expect(context.summary.plannedMinutes).toBe(90)
    expect(context.summary.freeMinutes).toBeGreaterThan(0)
    expect(context.availability.declared).toHaveLength(1)
  })
})

describe('planner schema upgrade', () => {
  beforeEach(freshDatabase)

  it('upgrades a v12 database to v13 without losing education tasks', async () => {
    await destroyDatabase()

    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mehr-life-os', DB_VERSION - 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('educationTasks', {
          keyPath: 'id',
        })
        store.createIndex('by_date_key', 'dateKey')
        store.createIndex('by_track', 'track')
        store.createIndex('by_status', 'status')
        store.createIndex('by_course', 'courseId')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const record = {
      id: 'legacy-task',
      track: 'masters',
      title: 'تسک قدیمی',
      priority: 'medium',
      dateKey: SATURDAY,
      time: '09:00',
      estimatedMinutes: 30,
      status: 'pending',
      actualSeconds: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction('educationTasks', 'readwrite')
      tx.objectStore('educationTasks').put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()

    await initializeOfflineStorage()

    await expect(getEducationTasks()).resolves.toContainEqual(
      expect.objectContaining({ id: 'legacy-task' })
    )
    await expect(getPlannerAvailability()).resolves.toEqual([])

    await deleteDatabase('mehr-life-os')
  })
})

/** Reads a task without importing another helper into this test file. */
async function getEducationTaskUnchanged(id: string) {
  const tasks = await getEducationTasks()
  return tasks.find((task) => task.id === id)
}
