/**
 * Daily and weekly goals.
 *
 * A goal is only a target. Actual progress is always derived from the real
 * activity stores (timeline/work sessions, education tasks and gym sessions),
 * so editing a target never rewrites or deletes historical records.
 */
import { createId } from '@/lib/id'
import { getDatabase, type LearningTrack } from '@/services/db'
import { deleteRecords, getAllRecords, putRecords } from '@/services/idb'
import { STORE_GOALS } from '@/services/stores'

export const GOAL_AXES = [
  'work_education',
  'education_track',
  'project',
  'gym',
] as const
export type GoalAxis = (typeof GOAL_AXES)[number]

export const GOAL_PERIODS = ['daily', 'weekly'] as const
export type GoalPeriod = (typeof GOAL_PERIODS)[number]

export interface GoalRecord {
  id: string
  axis: GoalAxis
  period: GoalPeriod
  /** Seconds for time goals; number of sessions for the gym axis. */
  target: number
  /** Only for `education_track`. */
  track?: LearningTrack
  /** Only for `project`. */
  projectId?: string
  createdAt: string
  updatedAt: string
}

export interface GoalInput {
  id?: string
  axis: GoalAxis
  period: GoalPeriod
  target: number
  track?: LearningTrack
  projectId?: string
}

const DAY_SECONDS = 24 * 60 * 60
const WEEK_SECONDS = 7 * DAY_SECONDS

export function isGoalAxis(value: unknown): value is GoalAxis {
  return GOAL_AXES.some((axis) => axis === value)
}

export function isGoalPeriod(value: unknown): value is GoalPeriod {
  return GOAL_PERIODS.some((period) => period === value)
}

/** Stable identity so one scope has exactly one daily and one weekly target. */
export function goalKey(
  goal: Pick<GoalInput, 'axis' | 'period' | 'track' | 'projectId'>
): string {
  const scope =
    goal.axis === 'education_track'
      ? (goal.track ?? 'missing-track')
      : goal.axis === 'project'
        ? (goal.projectId ?? 'missing-project')
        : 'all'
  return `${goal.axis}:${goal.period}:${scope}`
}

function validate(input: GoalInput): void {
  if (!isGoalAxis(input.axis)) throw new RangeError('unknown goal axis')
  if (!isGoalPeriod(input.period)) throw new RangeError('unknown goal period')
  if (!Number.isInteger(input.target) || input.target <= 0) {
    throw new RangeError('goal target must be a positive whole number')
  }
  if (input.axis === 'gym') {
    const max = input.period === 'daily' ? 20 : 100
    if (input.target > max)
      throw new RangeError(`gym target must be at most ${max} sessions`)
    return
  }
  const max = input.period === 'daily' ? DAY_SECONDS : WEEK_SECONDS
  if (input.target > max)
    throw new RangeError('goal target is larger than the period')
  if (input.axis === 'education_track' && !input.track) {
    throw new RangeError('an education-track goal needs a track')
  }
  if (input.axis === 'project' && !input.projectId?.trim()) {
    throw new RangeError('a project goal needs a project')
  }
}

/** Saves (or replaces) the target of one scope; history is untouched. */
export async function saveGoal(input: GoalInput): Promise<GoalRecord> {
  validate(input)
  const id = input.id?.trim() || goalKey(input)
  const db = await getDatabase()
  const existing = (await getAllRecords<GoalRecord>(db, STORE_GOALS)).find(
    (goal) => goal.id === id || goal.id === goalKey(input)
  )
  const now = new Date().toISOString()
  const record: GoalRecord = {
    id: existing?.id ?? id,
    axis: input.axis,
    period: input.period,
    target: input.target,
    ...(input.axis === 'education_track' && input.track
      ? { track: input.track }
      : {}),
    ...(input.axis === 'project' && input.projectId
      ? { projectId: input.projectId }
      : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await putRecords(db, STORE_GOALS, [record])
  return record
}

export async function deleteGoal(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_GOALS, [id])
}

/** Defaults are targets, never fake performance; they can be edited any time. */
export const DEFAULT_GOALS: ReadonlyArray<
  Pick<GoalInput, 'axis' | 'period' | 'target'>
> = [
  { axis: 'work_education', period: 'daily', target: 4 * 60 * 60 },
  { axis: 'work_education', period: 'weekly', target: 28 * 60 * 60 },
  { axis: 'gym', period: 'weekly', target: 3 },
]

async function seedDefaults(): Promise<GoalRecord[]> {
  const now = new Date().toISOString()
  const records = DEFAULT_GOALS.map((goal) => ({
    ...goal,
    id: goalKey(goal),
    createdAt: now,
    updatedAt: now,
  }))
  const db = await getDatabase()
  await putRecords(db, STORE_GOALS, records)
  return records
}

/** All targets, seeded once with editable defaults when the store is empty. */
export async function getGoals(): Promise<GoalRecord[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<GoalRecord>(db, STORE_GOALS)
  if (!rows.length) return seedDefaults()
  return [...rows].sort(
    (a, b) =>
      GOAL_AXES.indexOf(a.axis) - GOAL_AXES.indexOf(b.axis) ||
      a.period.localeCompare(b.period) ||
      a.id.localeCompare(b.id)
  )
}

/** Convenience lookup used by the dashboard and goals page. */
export function findGoal(
  goals: GoalRecord[],
  axis: GoalAxis,
  period: GoalPeriod,
  scope: { track?: LearningTrack; projectId?: string } = {}
): GoalRecord | undefined {
  const key = goalKey({ axis, period, ...scope })
  return (
    goals.find((goal) => goal.id === key) ??
    goals.find(
      (goal) =>
        goal.axis === axis &&
        goal.period === period &&
        (axis !== 'education_track' || goal.track === scope.track) &&
        (axis !== 'project' || goal.projectId === scope.projectId)
    )
  )
}

/** Creates a stable id for callers that build a goal before saving it. */
export function newGoalId(): string {
  return createId('goal')
}
