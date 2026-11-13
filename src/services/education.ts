import { isDateKey, toDateKey } from '@/lib/date-key'
import { createId } from '@/lib/id'
import { isClockTime } from '@/lib/time'
import {
  getDatabase,
  isLearningTrack,
  STORE_EDUCATION_ITEMS,
  STORE_EDUCATION_REPORTS,
  STORE_EDUCATION_TASKS,
  type LearningTrack,
} from '@/services/db'
import {
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  putRecords,
} from '@/services/idb'
import type { EducationItem } from '@/services/learning'
import {
  isTaskPriority,
  TASK_PRIORITIES,
  type TaskPriority,
} from '@/types/timeline'

export const EDUCATION_TASK_STATUSES = [
  'pending',
  'in_progress',
  'paused',
  'completed',
] as const

export type EducationTaskStatus = (typeof EDUCATION_TASK_STATUSES)[number]

/**
 * One actionable study task. The three education paths share this single model,
 * so the timer rule (only one running task at a time) is global.
 */
export interface EducationTask {
  id: string
  track: LearningTrack
  /** Linked master's, university or training course. */
  courseId?: string
  title: string
  description?: string
  priority: TaskPriority
  /** Gregorian local day key of the planned study date. */
  dateKey: string
  /** Strict `HH:MM` 24-hour start time. */
  time: string
  estimatedMinutes: number
  status: EducationTaskStatus
  /** Settled study seconds; excludes the currently running interval. */
  actualSeconds: number
  /** Settled study seconds per local day, used for today/week summaries. */
  dailySeconds?: Record<string, number>
  /** Non-null only while this task owns the single active education timer. */
  timerStartedAt?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface EducationTaskInput {
  id?: string
  track: LearningTrack
  courseId?: string
  title: string
  description?: string
  priority: TaskPriority
  dateKey: string
  time: string
  estimatedMinutes: number
  status?: EducationTaskStatus
}

/** A timestamped progress report. Reports are append-only history entries. */
export interface EducationReport {
  id: string
  taskId: string
  /** Snapshot of the task at report time. */
  track: LearningTrack
  courseId?: string
  courseTitle?: string
  taskTitle: string
  taskStatus: EducationTaskStatus
  /** Local calendar day of the report timestamp. */
  dateKey: string
  createdAt: string
  updatedAt: string
  /** Total studied seconds of the task when this report was written. */
  durationSeconds: number
  summary: string
  topics?: string
  exercises?: string
  problems?: string
  resumePoint?: string
}

export interface EducationReportInput {
  taskId: string
  summary: string
  topics?: string
  exercises?: string
  problems?: string
  resumePoint?: string
}

export interface EducationReportPatch {
  summary?: string
  topics?: string
  exercises?: string
  problems?: string
  resumePoint?: string
}

export interface EducationTimerState {
  actualSeconds: number
  dailySeconds?: Record<string, number>
  timerStartedAt?: string
  status: EducationTaskStatus
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function assertTaskStatus(value: unknown): EducationTaskStatus {
  const status = EDUCATION_TASK_STATUSES.find((entry) => entry === value)
  if (!status) throw new RangeError('unknown education task status')
  return status
}

/**
 * Splits a live timer interval into local calendar days.
 *
 * Study time is derived from real timestamps, never from a per-second counter,
 * so a refresh, a sleeping laptop or a background tab cannot skew it.
 */
export function splitStudySecondsByDay(
  startedAt: string,
  endedAtMs: number
): Record<string, number> {
  const result: Record<string, number> = {}
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startMs) {
    return result
  }
  let cursor = startMs
  while (cursor < endedAtMs) {
    const current = new Date(cursor)
    const nextMidnight = new Date(cursor)
    nextMidnight.setHours(24, 0, 0, 0)
    let boundary = nextMidnight.getTime()
    if (!Number.isFinite(boundary) || boundary <= cursor) {
      boundary = cursor + 86_400_000
    }
    const chunkEnd = Math.min(endedAtMs, boundary)
    const seconds = Math.max(0, Math.floor((chunkEnd - cursor) / 1000))
    if (seconds > 0) {
      const dayKey = toDateKey(current)
      result[dayKey] = (result[dayKey] ?? 0) + seconds
    }
    cursor = chunkEnd
  }
  return result
}

/** Total studied seconds including the live interval. */
export function educationElapsedSeconds(
  task: Pick<EducationTask, 'actualSeconds' | 'timerStartedAt'>,
  nowMs = Date.now()
): number {
  const settled = Math.max(0, Math.floor(task.actualSeconds || 0))
  if (!task.timerStartedAt) return settled
  const startMs = Date.parse(task.timerStartedAt)
  if (!Number.isFinite(startMs)) return settled
  return settled + Math.max(0, Math.floor((nowMs - startMs) / 1000))
}

/** Studied seconds on one local day, including the live interval. */
export function educationSecondsOnDay(
  task: Pick<EducationTask, 'dailySeconds' | 'timerStartedAt'>,
  dateKey: string,
  nowMs = Date.now()
): number {
  const settled = Math.max(0, Math.floor(task.dailySeconds?.[dateKey] ?? 0))
  if (!task.timerStartedAt) return settled
  const live = splitStudySecondsByDay(task.timerStartedAt, nowMs)[dateKey] ?? 0
  return settled + live
}

/**
 * Stops a running interval at `nowMs`, adds its seconds to both the total and
 * the per-day buckets, and returns a paused copy.
 */
export function settleEducationTask<T extends EducationTimerState>(
  task: T,
  nowMs = Date.now()
): T {
  if (!task.timerStartedAt) return task
  const updatedAt = new Date(nowMs).toISOString()
  const startMs = Date.parse(task.timerStartedAt)
  const completed = task.status === 'completed'
  if (!Number.isFinite(startMs) || nowMs <= startMs) {
    return {
      ...task,
      timerStartedAt: undefined,
      status: completed ? 'completed' : 'paused',
      updatedAt,
    } as T
  }
  const liveSeconds = Math.floor((nowMs - startMs) / 1000)
  const dailySeconds = { ...(task.dailySeconds ?? {}) }
  for (const [day, seconds] of Object.entries(
    splitStudySecondsByDay(task.timerStartedAt, nowMs)
  )) {
    dailySeconds[day] = (dailySeconds[day] ?? 0) + seconds
  }
  return {
    ...task,
    actualSeconds: Math.max(0, Math.floor(task.actualSeconds || 0)) + liveSeconds,
    dailySeconds,
    timerStartedAt: undefined,
    status: completed ? 'completed' : 'paused',
    updatedAt,
  } as T
}

function buildTask(
  input: EducationTaskInput,
  base: EducationTask | undefined,
  nowMs: number
): EducationTask {
  if (!isLearningTrack(input.track)) throw new RangeError('unknown education path')
  if (!input.title.trim()) throw new RangeError('task title is required')
  if (!isTaskPriority(input.priority)) throw new RangeError('unknown task priority')
  if (!isDateKey(input.dateKey)) throw new RangeError('task date must use YYYY-MM-DD')
  if (!isClockTime(input.time)) throw new RangeError('task time must use 24-hour HH:MM')
  if (
    !Number.isInteger(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > 10_080
  ) {
    throw new RangeError('estimated minutes must be a positive whole number')
  }

  let status = assertTaskStatus(input.status ?? base?.status ?? 'pending')
  let timerStartedAt = base?.timerStartedAt
  let actualSeconds = Math.max(0, Math.floor(base?.actualSeconds ?? 0))
  let dailySeconds = base?.dailySeconds
  let completedAt = base?.completedAt

  // Changing a running task away from "in progress" settles its live interval
  // before the new status is written, so no time is lost.
  if (base?.timerStartedAt && status !== 'in_progress') {
    const settled = settleEducationTask(base, nowMs)
    timerStartedAt = undefined
    actualSeconds = settled.actualSeconds
    dailySeconds = settled.dailySeconds
    completedAt = settled.completedAt
  }
  // A task cannot claim a running status without an actual running interval.
  if (status === 'in_progress' && !timerStartedAt) status = 'paused'
  if (status === 'completed') {
    completedAt = completedAt ?? new Date(nowMs).toISOString()
  } else {
    completedAt = undefined
  }

  const nowIso = new Date(nowMs).toISOString()
  const description = optionalText(input.description)
  const courseId = optionalText(input.courseId)
  return {
    id: base?.id ?? input.id ?? createId('edu-task'),
    track: input.track,
    ...(courseId ? { courseId } : {}),
    title: input.title.trim(),
    ...(description ? { description } : {}),
    priority: input.priority,
    dateKey: input.dateKey,
    time: input.time,
    estimatedMinutes: input.estimatedMinutes,
    status,
    actualSeconds,
    ...(dailySeconds && Object.keys(dailySeconds).length ? { dailySeconds } : {}),
    ...(timerStartedAt ? { timerStartedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    createdAt: base?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }
}

export async function getEducationTasks(): Promise<EducationTask[]> {
  const db = await getDatabase()
  return getAllRecords<EducationTask>(db, STORE_EDUCATION_TASKS)
}

export async function getEducationTask(id: string): Promise<EducationTask | undefined> {
  const db = await getDatabase()
  return getRecord<EducationTask>(db, STORE_EDUCATION_TASKS, id)
}

export async function getActiveEducationTask(): Promise<EducationTask | undefined> {
  const tasks = await getEducationTasks()
  return tasks.find((task) => Boolean(task.timerStartedAt))
}

export async function saveEducationTask(
  input: EducationTaskInput,
  nowMs = Date.now()
): Promise<EducationTask> {
  const db = await getDatabase()
  const base = input.id
    ? await getRecord<EducationTask>(db, STORE_EDUCATION_TASKS, input.id)
    : undefined
  if (input.id && !base) throw new RangeError('education task does not exist')
  const courseId = optionalText(input.courseId)
  if (courseId) {
    const course = await getRecord<EducationItem>(db, STORE_EDUCATION_ITEMS, courseId)
    if (!course) throw new RangeError('linked course does not exist')
    if (course.track !== input.track) {
      throw new RangeError('linked course belongs to another education path')
    }
  }
  const record = buildTask(input, base, nowMs)
  await putRecords(db, STORE_EDUCATION_TASKS, [record])
  return record
}

/**
 * Atomically starts the timer of one task and settles every other running
 * interval first.
 *
 * A single readwrite IndexedDB transaction serialises simultaneous attempts
 * from multiple tabs: the second transaction sees the first one's result, so
 * the database can never contain two running education timers.
 */
export async function startEducationTaskTimer(
  taskId: string,
  nowMs = Date.now()
): Promise<EducationTask> {
  const db = await getDatabase()
  return new Promise<EducationTask>((resolve, reject) => {
    const transaction = db.transaction(STORE_EDUCATION_TASKS, 'readwrite')
    const store = transaction.objectStore(STORE_EDUCATION_TASKS)
    let updated: EducationTask | undefined
    let failure: Error | undefined
    const request = store.getAll()

    request.onsuccess = () => {
      const tasks = request.result as EducationTask[]
      const target = tasks.find((task) => task.id === taskId)
      if (!target) {
        failure = new RangeError(`education task "${taskId}" does not exist`)
        transaction.abort()
        return
      }
      if (target.status === 'completed') {
        failure = new RangeError('a completed education task can not be started')
        transaction.abort()
        return
      }
      const nowIso = new Date(nowMs).toISOString()
      for (const task of tasks) {
        if (task.id === taskId) {
          updated = {
            ...task,
            status: 'in_progress',
            // Re-starting the same task keeps its original interval start.
            timerStartedAt: task.timerStartedAt ?? nowIso,
            updatedAt: nowIso,
            completedAt: undefined,
          }
          store.put(updated)
        } else if (task.timerStartedAt) {
          store.put(settleEducationTask(task, nowMs))
        }
      }
    }
    request.onerror = () => {
      failure = new Error('failed to read education tasks')
    }
    transaction.oncomplete = () => {
      if (updated) resolve(updated)
      else reject(failure ?? new Error('the education timer did not start'))
    }
    transaction.onerror = () =>
      reject(failure ?? transaction.error ?? new Error('the education timer did not start'))
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error('the education timer did not start'))
  })
}

async function settleTaskStatus(
  taskId: string,
  status: 'paused' | 'completed',
  nowMs: number
): Promise<EducationTask> {
  const db = await getDatabase()
  return new Promise<EducationTask>((resolve, reject) => {
    const transaction = db.transaction(STORE_EDUCATION_TASKS, 'readwrite')
    const store = transaction.objectStore(STORE_EDUCATION_TASKS)
    let updated: EducationTask | undefined
    let failure: Error | undefined
    const request = store.get(taskId)

    request.onsuccess = () => {
      const task = request.result as EducationTask | undefined
      if (!task) {
        failure = new RangeError(`education task "${taskId}" does not exist`)
        transaction.abort()
        return
      }
      const settled = settleEducationTask(task, nowMs)
      const nowIso = new Date(nowMs).toISOString()
      updated =
        status === 'completed'
          ? {
              ...settled,
              status: 'completed',
              completedAt: nowIso,
              updatedAt: nowIso,
            }
          : { ...settled, status: 'paused', updatedAt: nowIso }
      store.put(updated)
    }
    request.onerror = () => {
      failure = new Error('failed to read the education task')
    }
    transaction.oncomplete = () => {
      if (updated) resolve(updated)
      else reject(failure ?? new Error('the education timer was not updated'))
    }
    transaction.onerror = () =>
      reject(failure ?? transaction.error ?? new Error('the education timer was not updated'))
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error('the education timer was not updated'))
  })
}

/** Pauses a task (Stop/Pause button). */
export function pauseEducationTaskTimer(
  taskId: string,
  nowMs = Date.now()
): Promise<EducationTask> {
  return settleTaskStatus(taskId, 'paused', nowMs)
}

/** Finishes a task (Finish button); elapsed time is preserved on the record. */
export function finishEducationTaskTimer(
  taskId: string,
  nowMs = Date.now()
): Promise<EducationTask> {
  return settleTaskStatus(taskId, 'completed', nowMs)
}

/** Deletes a task together with its progress reports in one transaction. */
export async function deleteEducationTask(taskId: string): Promise<void> {
  const db = await getDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      [STORE_EDUCATION_TASKS, STORE_EDUCATION_REPORTS],
      'readwrite'
    )
    transaction.objectStore(STORE_EDUCATION_TASKS).delete(taskId)
    const reports = transaction.objectStore(STORE_EDUCATION_REPORTS)
    const keysRequest = reports.index('by_task').getAllKeys(taskId)
    keysRequest.onsuccess = () => {
      for (const key of keysRequest.result) reports.delete(key)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('failed to delete the education task'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('failed to delete the education task'))
  })
}

/** Removes the course link from its tasks without deleting the tasks. */
export async function detachCourseFromEducationTasks(
  courseId: string,
  nowMs = Date.now()
): Promise<void> {
  const db = await getDatabase()
  const tasks = await getAllFromIndex<EducationTask>(
    db,
    STORE_EDUCATION_TASKS,
    'by_course',
    courseId
  )
  if (tasks.length === 0) return
  const updatedAt = new Date(nowMs).toISOString()
  await putRecords(
    db,
    STORE_EDUCATION_TASKS,
    tasks.map((task) => ({ ...task, courseId: undefined, updatedAt }))
  )
}

export async function getEducationReports(): Promise<EducationReport[]> {
  const db = await getDatabase()
  return getAllRecords<EducationReport>(db, STORE_EDUCATION_REPORTS)
}

export async function getEducationReportsByTask(
  taskId: string
): Promise<EducationReport[]> {
  const db = await getDatabase()
  return getAllFromIndex<EducationReport>(
    db,
    STORE_EDUCATION_REPORTS,
    'by_task',
    taskId
  )
}

export async function saveEducationReport(
  input: EducationReportInput,
  nowMs = Date.now()
): Promise<EducationReport> {
  const summary = input.summary.trim()
  if (!summary) throw new RangeError('a progress report needs a summary')
  const db = await getDatabase()
  const task = await getRecord<EducationTask>(db, STORE_EDUCATION_TASKS, input.taskId)
  if (!task) throw new RangeError('the education task does not exist')
  const course = task.courseId
    ? await getRecord<EducationItem>(db, STORE_EDUCATION_ITEMS, task.courseId)
    : undefined
  const nowIso = new Date(nowMs).toISOString()
  const topics = optionalText(input.topics)
  const exercises = optionalText(input.exercises)
  const problems = optionalText(input.problems)
  const resumePoint = optionalText(input.resumePoint)
  const record: EducationReport = {
    id: createId('edu-report'),
    taskId: task.id,
    track: task.track,
    ...(task.courseId ? { courseId: task.courseId } : {}),
    ...(course ? { courseTitle: course.title } : {}),
    taskTitle: task.title,
    taskStatus: task.status,
    dateKey: toDateKey(new Date(nowMs)),
    createdAt: nowIso,
    updatedAt: nowIso,
    durationSeconds: educationElapsedSeconds(task, nowMs),
    summary,
    ...(topics ? { topics } : {}),
    ...(exercises ? { exercises } : {}),
    ...(problems ? { problems } : {}),
    ...(resumePoint ? { resumePoint } : {}),
  }
  await putRecords(db, STORE_EDUCATION_REPORTS, [record])
  return record
}

/**
 * Edits the text of one report. The timestamp, duration and task snapshot stay
 * untouched, and other reports of the same task remain independent entries.
 */
export async function updateEducationReport(
  id: string,
  patch: EducationReportPatch,
  nowMs = Date.now()
): Promise<EducationReport> {
  const db = await getDatabase()
  const base = await getRecord<EducationReport>(db, STORE_EDUCATION_REPORTS, id)
  if (!base) throw new RangeError('the progress report does not exist')
  const summary = (patch.summary ?? base.summary).trim()
  if (!summary) throw new RangeError('a progress report needs a summary')
  const topics = optionalText(patch.topics !== undefined ? patch.topics : base.topics)
  const exercises = optionalText(
    patch.exercises !== undefined ? patch.exercises : base.exercises
  )
  const problems = optionalText(
    patch.problems !== undefined ? patch.problems : base.problems
  )
  const resumePoint = optionalText(
    patch.resumePoint !== undefined ? patch.resumePoint : base.resumePoint
  )
  const record: EducationReport = {
    ...base,
    summary,
    updatedAt: new Date(nowMs).toISOString(),
    ...(topics ? { topics } : {}),
    ...(exercises ? { exercises } : {}),
    ...(problems ? { problems } : {}),
    ...(resumePoint ? { resumePoint } : {}),
  }
  if (!topics) delete record.topics
  if (!exercises) delete record.exercises
  if (!problems) delete record.problems
  if (!resumePoint) delete record.resumePoint
  await putRecords(db, STORE_EDUCATION_REPORTS, [record])
  return record
}

export async function deleteEducationReport(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_EDUCATION_REPORTS, [id])
}

export { TASK_PRIORITIES }
