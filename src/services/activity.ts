/**
 * Read-only aggregation of the real activity stores for one day range.
 *
 * Nothing is copied to a second database: work time uses the canonical
 * `calculateWorkTime` (timeline blocks + unlinked sessions), education uses the
 * persisted per-day seconds and gym sessions are the real `gymSessions` rows.
 * The same aggregate feeds goals, the dashboard and the analytics center.
 */
import type { TimelineBlockRecord } from '@/types/timeline'
import type { WorkSessionRecord } from '@/types/work'
import { toDateKey } from '@/lib/date-key'
import { calculateWorkTime, timelineBlockSeconds } from '@/lib/work-time'
import {
  getTimelineBlocksByRange,
  getWorkSessionsByRange,
  type LearningTrack,
} from '@/services/db'
import {
  educationSecondsOnDay,
  getEducationTasks,
  type EducationTask,
} from '@/services/education'
import { getGymSessions, type GymSession } from '@/services/gym'
import { dayKeysBetween } from '@/features/goals/goal-utils'

export interface ActivityRange {
  fromKey: string
  toKey: string
  days: string[]
  blocks: TimelineBlockRecord[]
  sessions: WorkSessionRecord[]
  educationTasks: EducationTask[]
  gymSessions: GymSession[]
  /** Real work seconds per day (same rule as the work report). */
  workByDay: Record<string, number>
  workSeconds: number
  /** Project-linked work seconds, only for blocks with a real project id. */
  workByProject: Record<string, number>
  workByProjectByDay: Record<string, Record<string, number>>
  educationByDay: Record<string, number>
  educationSeconds: number
  educationByTrack: Record<LearningTrack, number>
  educationByCourse: Record<string, number>
  /** Finished sessions (`status: 'done'`) per day — the gym goal source. */
  gymByDay: Record<string, number>
  gymCompleted: number
}

function add(map: Record<string, number>, key: string, value: number): void {
  if (!value) return
  map[key] = (map[key] ?? 0) + value
}

export async function loadActivityRange(
  from: Date | string,
  to: Date | string,
  now = Date.now()
): Promise<ActivityRange> {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  const days = dayKeysBetween(fromKey, toKey)
  const [blocks, sessions, educationTasks, gymSessions] = await Promise.all([
    getTimelineBlocksByRange(fromKey, toKey),
    getWorkSessionsByRange(fromKey, toKey),
    getEducationTasks(),
    getGymSessions(),
  ])

  const workByDay: Record<string, number> = {}
  const workByProject: Record<string, number> = {}
  const workByProjectByDay: Record<string, Record<string, number>> = {}
  let workSeconds = 0

  for (const day of days) {
    const dayBlocks = blocks.filter((block) => block.dateKey === day)
    const daySessions = sessions.filter((session) => session.dateKey === day)
    const daySeconds = calculateWorkTime(
      dayBlocks,
      daySessions,
      'all',
      now
    ).seconds
    workByDay[day] = daySeconds
    workSeconds += daySeconds
    for (const block of dayBlocks) {
      if (!block.projectId) continue
      const seconds = timelineBlockSeconds(block, now)
      if (!seconds) continue
      add(workByProject, block.projectId, seconds)
      workByProjectByDay[day] = workByProjectByDay[day] ?? {}
      add(workByProjectByDay[day], block.projectId, seconds)
    }
  }

  const educationByDay: Record<string, number> = {}
  const educationByTrack: Record<LearningTrack, number> = {
    masters: 0,
    university: 0,
    course: 0,
  }
  const educationByCourse: Record<string, number> = {}
  let educationSeconds = 0
  for (const task of educationTasks) {
    for (const day of days) {
      const seconds = educationSecondsOnDay(task, day, now)
      if (!seconds) continue
      add(educationByDay, day, seconds)
      educationByTrack[task.track] += seconds
      if (task.courseId) add(educationByCourse, task.courseId, seconds)
      educationSeconds += seconds
    }
  }

  const gymByDay: Record<string, number> = {}
  let gymCompleted = 0
  for (const session of gymSessions) {
    if (session.status !== 'done' || !days.includes(session.dateKey)) continue
    add(gymByDay, session.dateKey, 1)
    gymCompleted += 1
  }

  return {
    fromKey,
    toKey,
    days,
    blocks,
    sessions,
    educationTasks,
    gymSessions: gymSessions.filter(
      (session) => session.dateKey >= fromKey && session.dateKey <= toKey
    ),
    workByDay,
    workSeconds,
    workByProject,
    workByProjectByDay,
    educationByDay,
    educationSeconds,
    educationByTrack,
    educationByCourse,
    gymByDay,
    gymCompleted,
  }
}

/** Combined work + education seconds per day, the basis of the work/education goal. */
export function combinedByDay(activity: ActivityRange): Record<string, number> {
  const result: Record<string, number> = {}
  for (const day of activity.days) {
    result[day] =
      (activity.workByDay[day] ?? 0) + (activity.educationByDay[day] ?? 0)
  }
  return result
}
