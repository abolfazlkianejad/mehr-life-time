/**
 * Read-only projection of the gym module into dashboard task cards.
 *
 * Plans and sessions stay in their own stores. A plan is shown only when no
 * session for the same plan/date already exists, so one workout never appears
 * twice. Every real session of the selected day is kept in chronological order.
 */
import { weekdayOfDateKey, type GymWeekday } from '@/lib/gym-weekdays'
import {
  gymElapsedSeconds,
  isGymTimerRunning,
  type GymExercise,
  type GymPlan,
  type GymSession,
} from '@/services/gym'

export type ExerciseActivityStatus =
  'planned' | 'draft' | 'running' | 'paused' | 'done'

export interface ExerciseActivity {
  key: string
  title: string
  dateKey: string
  weekday: GymWeekday
  plannedMinutes?: number
  exerciseNames: string[]
  status: ExerciseActivityStatus
  session?: GymSession
  /** Seconds already measured; the card's live ticker adds open time. */
  elapsedSeconds: number
  /** Stable chronological position inside the selected day. */
  order: number
}

function sessionStatus(session: GymSession): ExerciseActivityStatus {
  if (session.status === 'done') return 'done'
  return isGymTimerRunning(session) ? 'running' : 'paused'
}

export function buildExerciseActivities(
  plans: GymPlan[],
  exercises: GymExercise[],
  sessions: GymSession[],
  dateKey: string,
  nowMs = Date.now()
): ExerciseActivity[] {
  const weekday = weekdayOfDateKey(dateKey)
  const plan = plans.find((entry) => entry.weekday === weekday)
  const exerciseNames = exercises
    .filter((entry) => entry.weekday === weekday)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    .map((entry) => entry.name)

  const daySessions = sessions
    .filter((session) => session.dateKey === dateKey)
    .sort((a, b) => {
      const started =
        a.startedAt.localeCompare(b.startedAt) ||
        a.createdAt.localeCompare(b.createdAt)
      return started || a.id.localeCompare(b.id)
    })

  const activities: ExerciseActivity[] = daySessions.map((session, index) => ({
    key: `gym-session:${session.id}`,
    title: session.title,
    dateKey,
    weekday,
    ...(session.plannedMinutes !== undefined
      ? { plannedMinutes: session.plannedMinutes }
      : plan?.title === session.title && plan.plannedMinutes !== undefined
        ? { plannedMinutes: plan.plannedMinutes }
        : {}),
    exerciseNames,
    status: sessionStatus(session),
    session,
    elapsedSeconds: gymElapsedSeconds(session, nowMs),
    order: index,
  }))

  const hasPlanSession =
    plan !== undefined &&
    daySessions.some((session) => session.title === plan.title)

  if (plan && !hasPlanSession) {
    activities.push({
      key: `gym-plan:${plan.weekday}:${dateKey}`,
      title: plan.title,
      dateKey,
      weekday,
      ...(plan.plannedMinutes !== undefined
        ? { plannedMinutes: plan.plannedMinutes }
        : {}),
      exerciseNames,
      status: 'planned',
      elapsedSeconds: 0,
      order: daySessions.length,
    })
  }

  return activities.sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key)
  )
}
