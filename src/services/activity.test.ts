import type { TimelineBlockRecord } from '@/types/timeline'
import { beforeEach, describe, expect, it } from 'vitest'
import { weekdayOfDateKey } from '@/lib/gym-weekdays'
import { loadActivityRange, combinedByDay } from '@/services/activity'
import {
  destroyDatabase,
  getDatabase,
  initializeOfflineStorage,
} from '@/services/db'
import type { EducationTask } from '@/services/education'
import type { GymSession } from '@/services/gym'
import { putRecords } from '@/services/idb'
import {
  STORE_EDUCATION_TASKS,
  STORE_GYM_SESSIONS,
  STORE_TIMELINE_BLOCKS,
} from '@/services/stores'

const DAY_ONE = '2026-01-15'
const DAY_TWO = '2026-01-16'
const NOW = new Date(2026, 0, 16, 20, 0, 0).getTime()

function block(
  overrides: Partial<TimelineBlockRecord> & { id: string; dateKey: string }
): TimelineBlockRecord {
  return {
    title: overrides.id,
    category: 'work',
    startTime: `${overrides.dateKey}T09:00:00.000Z`,
    endTime: `${overrides.dateKey}T10:00:00.000Z`,
    durationMinutes: 60,
    energyLevelRequired: 3,
    status: 'completed',
    isConflictFree: true,
    createdAt: `${overrides.dateKey}T00:00:00.000Z`,
    updatedAt: `${overrides.dateKey}T00:00:00.000Z`,
    isCompanyWork: true,
    priority: 'medium',
    ...overrides,
  }
}

function educationTask(
  overrides: Partial<EducationTask> & { id: string; dateKey: string }
): EducationTask {
  return {
    track: 'masters',
    title: overrides.id,
    priority: 'medium',
    time: '09:00',
    estimatedMinutes: 60,
    status: 'completed',
    actualSeconds: 0,
    dailySeconds: {},
    createdAt: `${overrides.dateKey}T00:00:00.000Z`,
    updatedAt: `${overrides.dateKey}T00:00:00.000Z`,
    ...overrides,
  }
}

function gymSession(
  overrides: Partial<GymSession> & { id: string; dateKey: string }
): GymSession {
  return {
    weekday: weekdayOfDateKey(overrides.dateKey),
    title: overrides.id,
    status: 'done',
    startedAt: `${overrides.dateKey}T18:00:00.000Z`,
    createdAt: `${overrides.dateKey}T18:00:00.000Z`,
    updatedAt: `${overrides.dateKey}T19:00:00.000Z`,
    ...overrides,
  }
}

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage(new Date(2026, 0, 15, 8, 0, 0))
}

async function seed(): Promise<void> {
  const db = await getDatabase()
  await putRecords<TimelineBlockRecord>(db, STORE_TIMELINE_BLOCKS, [
    block({
      id: 'w1',
      dateKey: DAY_ONE,
      elapsedSeconds: 3600,
      projectId: 'p1',
    }),
    block({ id: 'w2', dateKey: DAY_ONE, elapsedSeconds: 600 }),
    block({
      id: 'w3',
      dateKey: DAY_TWO,
      elapsedSeconds: 1800,
      projectId: 'p1',
    }),
  ])
  await putRecords<EducationTask>(db, STORE_EDUCATION_TASKS, [
    educationTask({
      id: 'e1',
      dateKey: DAY_ONE,
      track: 'masters',
      courseId: 'c1',
      dailySeconds: { [DAY_ONE]: 1800 },
    }),
    educationTask({
      id: 'e2',
      dateKey: DAY_TWO,
      track: 'course',
      courseId: 'c1',
      dailySeconds: { [DAY_TWO]: 900 },
    }),
    educationTask({
      id: 'e3',
      dateKey: DAY_TWO,
      track: 'course',
      courseId: 'c2',
      dailySeconds: { [DAY_TWO]: 600 },
    }),
  ])
  await putRecords<GymSession>(db, STORE_GYM_SESSIONS, [
    gymSession({ id: 'g1', dateKey: DAY_ONE }),
    gymSession({ id: 'g2', dateKey: DAY_TWO }),
    gymSession({ id: 'g3', dateKey: DAY_TWO, status: 'draft' }),
  ])
}

describe('activity aggregation (goals, dashboard, analytics)', () => {
  beforeEach(freshDatabase)

  it('sums work from real elapsed timers without double counting', async () => {
    await seed()
    const range = await loadActivityRange(DAY_ONE, DAY_TWO, NOW)
    expect(range.workByDay[DAY_ONE]).toBe(4200)
    expect(range.workByDay[DAY_TWO]).toBe(1800)
    expect(range.workSeconds).toBe(6000)
    // Project hours count only blocks that carry a real project id.
    expect(range.workByProject).toEqual({ p1: 5400 })
    expect(range.workByProjectByDay[DAY_ONE]).toEqual({ p1: 3600 })
    expect(range.workByProjectByDay[DAY_TWO]).toEqual({ p1: 1800 })
  })

  it('splits education by track and by course with the same total', async () => {
    await seed()
    const range = await loadActivityRange(DAY_ONE, DAY_TWO, NOW)
    expect(range.educationByDay[DAY_ONE]).toBe(1800)
    expect(range.educationByDay[DAY_TWO]).toBe(1500)
    expect(range.educationSeconds).toBe(3300)
    expect(range.educationByTrack).toEqual({
      masters: 1800,
      university: 0,
      course: 1500,
    })
    expect(range.educationByCourse).toEqual({ c1: 2700, c2: 600 })
    const trackSum = Object.values(range.educationByTrack).reduce(
      (total, value) => total + value,
      0
    )
    const courseSum = Object.values(range.educationByCourse).reduce(
      (total, value) => total + value,
      0
    )
    expect(trackSum).toBe(range.educationSeconds)
    expect(courseSum).toBe(range.educationSeconds)
  })

  it('counts only done gym sessions in the goal source and keeps drafts for the day list', async () => {
    await seed()
    const range = await loadActivityRange(DAY_ONE, DAY_TWO, NOW)
    expect(range.gymByDay[DAY_ONE]).toBe(1)
    expect(range.gymByDay[DAY_TWO]).toBe(1)
    expect(range.gymCompleted).toBe(2)
    expect(
      range.gymSessions.filter((session) => session.dateKey === DAY_TWO)
    ).toHaveLength(2)
    expect(
      range.gymSessions.find((session) => session.id === 'g3')?.status
    ).toBe('draft')
  })

  it('feeds the work/education goal with a single per-day sum', async () => {
    await seed()
    const range = await loadActivityRange(DAY_ONE, DAY_TWO, NOW)
    expect(combinedByDay(range)).toEqual({
      [DAY_ONE]: 6000,
      [DAY_TWO]: 3300,
    })
    const weeklyTotal = Object.values(combinedByDay(range)).reduce(
      (total, value) => total + value,
      0
    )
    expect(weeklyTotal).toBe(range.workSeconds + range.educationSeconds)
  })

  it('behaves like the dashboard date filter for one selected day', async () => {
    await seed()
    const first = await loadActivityRange(DAY_ONE, DAY_ONE, NOW)
    expect(first.days).toEqual([DAY_ONE])
    expect(first.workByDay[DAY_ONE]).toBe(4200)
    expect(first.educationByDay[DAY_ONE]).toBe(1800)
    expect(first.gymByDay[DAY_ONE]).toBe(1)
    expect(first.workByProjectByDay[DAY_ONE]).toEqual({ p1: 3600 })

    const second = await loadActivityRange(DAY_TWO, DAY_TWO, NOW)
    expect(second.workByDay[DAY_TWO]).toBe(1800)
    expect(second.educationByDay[DAY_TWO]).toBe(1500)
    expect(second.gymByDay[DAY_TWO]).toBe(1)
    // The other day is not leaked into the selected day.
    expect(second.workByDay[DAY_ONE]).toBeUndefined()
    expect(second.educationByDay[DAY_ONE]).toBeUndefined()
  })
})
