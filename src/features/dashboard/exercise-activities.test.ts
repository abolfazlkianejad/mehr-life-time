import { describe, expect, it } from 'vitest'
import type { GymExercise, GymPlan, GymSession } from '@/services/gym'
import { buildExerciseActivities } from './exercise-activities'

const SATURDAY = '2026-01-17'
const FRIDAY = '2026-01-16'
const NOW = Date.parse('2026-01-17T12:00:00.000Z')

function plan(title = 'Push day', plannedMinutes = 45): GymPlan {
  return {
    weekday: 0,
    title,
    plannedMinutes,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function exercise(name: string, order: number): GymExercise {
  return {
    id: `ex-${name}`,
    weekday: 0,
    name,
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function session(
  id: string,
  title: string,
  startedAt: string,
  overrides: Partial<GymSession> = {}
): GymSession {
  return {
    id,
    dateKey: SATURDAY,
    weekday: 0,
    title,
    status: 'draft',
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  }
}

describe('buildExerciseActivities', () => {
  it('shows a planned workout on the selected date only, with plan details', () => {
    const activities = buildExerciseActivities(
      [plan()],
      [exercise('Bench press', 1), exercise('Shoulder press', 2)],
      [],
      SATURDAY,
      NOW
    )

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      key: `gym-plan:0:${SATURDAY}`,
      title: 'Push day',
      dateKey: SATURDAY,
      weekday: 0,
      plannedMinutes: 45,
      exerciseNames: ['Bench press', 'Shoulder press'],
      status: 'planned',
    })
    expect(buildExerciseActivities([plan()], [], [], FRIDAY, NOW)).toEqual([])
  })

  it('does not duplicate a plan that already has a session for the day', () => {
    const activities = buildExerciseActivities(
      [plan()],
      [],
      [session('s1', 'Push day', '2026-01-17T08:00:00.000Z')],
      SATURDAY,
      NOW
    )

    expect(activities).toHaveLength(1)
    expect(activities[0]?.key).toBe('gym-session:s1')
    expect(activities[0]?.plannedMinutes).toBe(45)
    expect(activities[0]?.status).toBe('paused')
  })

  it('keeps every real session of the day in chronological order', () => {
    const activities = buildExerciseActivities(
      [],
      [],
      [
        session('late', 'Evening', '2026-01-17T18:00:00.000Z'),
        session('running', 'Morning', '2026-01-17T08:00:00.000Z', {
          timerStartedAt: '2026-01-17T11:30:00.000Z',
          elapsedSeconds: 600,
        }),
        session('done', 'Noon', '2026-01-17T12:00:00.000Z', {
          status: 'done',
          actualSeconds: 1800,
        }),
      ],
      SATURDAY,
      NOW
    )

    expect(activities.map((activity) => activity.key)).toEqual([
      'gym-session:running',
      'gym-session:done',
      'gym-session:late',
    ])
    expect(activities.map((activity) => activity.status)).toEqual([
      'running',
      'done',
      'paused',
    ])
    expect(activities[0]?.elapsedSeconds).toBe(2400)
  })

  it('treats an invalid stored timer as paused without losing settled seconds', () => {
    const activities = buildExerciseActivities(
      [],
      [],
      [
        session('bad', 'Old workout', '2026-01-17T08:00:00.000Z', {
          timerStartedAt: 'not-a-date',
          elapsedSeconds: 120,
        }),
      ],
      SATURDAY,
      NOW
    )

    expect(activities[0]?.status).toBe('paused')
    expect(activities[0]?.elapsedSeconds).toBe(120)
  })
})
