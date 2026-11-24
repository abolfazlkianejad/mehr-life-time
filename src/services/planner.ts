/**
 * Planner domain service.
 *
 * This is the data layer behind the local planner agent. It is deliberately a
 * thin, storage-focused service: it validates and persists availability
 * windows and education tasks, computes busy/free intervals and rejects
 * scheduling conflicts. The *decision* about what to schedule lives in the
 * agent (the LLM), which reads context through `getPlannerContext` and writes
 * plans through the create/update/reschedule functions below.
 *
 * All writes carry an optional `requestId`. When a request id is repeated the
 * stored result is returned instead of writing again, so a retried tool call
 * can never create duplicate records. Plan entries may also carry a stable
 * client-generated `id`; entries with an existing id are upserted instead of
 * duplicated.
 *
 * Tasks created through this service are flagged `plannerManaged`, which is
 * the ownership check used by `deletePlannerItem` (the agent may reschedule
 * any education task, but it can only delete items it created itself plus
 * availability blocks, which are planner-scoped by definition).
 */
import {
  isTaskPriority,
  type TaskPriority,
  type TimelineBlockRecord,
} from '@/types/timeline'
import {
  fromDateKey,
  isDateKey,
  listDateKeys,
  toDateKey,
  type DateInput,
} from '@/lib/date-key'
import { weekdayOfDateKey } from '@/lib/gym-weekdays'
import { createId } from '@/lib/id'
import { clockDateFromParts, clockTimeFromDate, isClockTime } from '@/lib/time'
import {
  getDatabase,
  getTimelineBlocksByRange,
  isLearningTrack,
  STORE_META,
  STORE_PLANNER_AVAILABILITY,
  type LearningTrack,
} from '@/services/db'
import {
  deleteEducationTask,
  getEducationTask,
  getEducationTasks,
  saveEducationTask,
  type EducationTask,
} from '@/services/education'
import {
  deleteRecords,
  getAllRecords,
  getRecord,
  putRecords,
} from '@/services/idb'
import { getEducationItems, type EducationItem } from '@/services/learning'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const PLANNER_AVAILABILITY_KINDS = ['busy', 'free'] as const
export type PlannerAvailabilityKind =
  (typeof PLANNER_AVAILABILITY_KINDS)[number]

export type PlannerErrorCode =
  | 'invalid_args'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'busy_timer'
  | 'internal'

/** Structured error raised by the planner service; serialised by the bridge. */
export class PlannerError extends Error {
  readonly code: PlannerErrorCode
  readonly details?: unknown

  constructor(code: PlannerErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'PlannerError'
    this.code = code
    this.details = details
  }
}

/**
 * One busy/free window declared by the user or the agent.
 *
 * Exactly one of `weekday` (recurring, Saturday-first 0..6) or `dateKey`
 * (one-off local day) must be present. Start/end are local wall-clock `HH:MM`
 * values, stored like the rest of the app (Gregorian day keys + 24-hour time).
 */
export interface PlannerAvailability {
  id: string
  kind: PlannerAvailabilityKind
  title: string
  weekday?: number
  dateKey?: string
  startClock: string
  endClock: string
  createdAt: string
  updatedAt: string
}

export interface PlannerAvailabilityInput {
  id?: string
  kind: PlannerAvailabilityKind
  title: string
  weekday?: number
  dateKey?: string
  startClock: string
  endClock: string
}

export interface PlannerInterval {
  /** ISO 8601 start of the interval. */
  startTime: string
  /** ISO 8601 end of the interval (strictly later than start). */
  endTime: string
}

export interface PlannerBusyInterval extends PlannerInterval {
  source: 'availability' | 'timeline' | 'education'
  title?: string
}

export interface PlannerFreeSlot extends PlannerInterval {
  dateKey: string
  minutes: number
}

export interface PlannerSlotOptions {
  dayStartHour?: number
  dayEndHour?: number
  minSlotMinutes?: number
  protectLunch?: boolean
  lunchStart?: string
  lunchEnd?: string
}

export const PLANNER_LUNCH_START = '13:00'
export const PLANNER_LUNCH_END = '14:00'

export interface PlannerWeekPlanEntry {
  /** Optional stable client id: repeating the same id updates instead of duplicating. */
  id?: string
  track: LearningTrack
  courseId?: string
  title: string
  description?: string
  priority: TaskPriority
  dateKey: string
  time: string
  estimatedMinutes: number
}

export interface PlannerTaskPatch {
  dateKey?: string
  time?: string
  estimatedMinutes?: number
  title?: string
  description?: string
  priority?: TaskPriority
  track?: LearningTrack
  courseId?: string
}

export interface PlannerTaskChange {
  id: string
  patch: PlannerTaskPatch
}

export interface PlannerWriteFailure {
  index: number
  id?: string
  code: PlannerErrorCode
  message: string
}

export interface CreateWeekPlanResult {
  created: EducationTask[]
  failed: PlannerWriteFailure[]
  duplicate?: boolean
  requestId?: string
}

export interface UpdateWeekPlanResult {
  updated: EducationTask[]
  failed: PlannerWriteFailure[]
  duplicate?: boolean
  requestId?: string
}

export interface PlannerTaskEntry {
  kind: 'education' | 'work'
  id: string
  title: string
  track?: LearningTrack
  courseId?: string
  dateKey: string
  /** Local `HH:MM` start (education tasks store it directly; work blocks derive it). */
  time: string
  startTime?: string
  endTime?: string
  estimatedMinutes: number
  status: string
  priority?: TaskPriority
  overdue: boolean
  plannerManaged?: boolean
}

export interface PlannerTaskFilters {
  dateFrom?: string
  dateTo?: string
  status?: string
  priority?: TaskPriority
  track?: LearningTrack
  overdue?: boolean
}

export interface AvailabilityReport {
  from: string
  to: string
  /** Raw declared blocks (busy and free). */
  declared: PlannerAvailability[]
  /** Expanded busy blocks (declared busy windows only). */
  declaredBusy: PlannerInterval[]
  /** Expanded free windows declared by the user. */
  declaredFree: PlannerInterval[]
  /** Every busy interval in the range (availability + timeline + education). */
  busy: PlannerBusyInterval[]
  /** Consecutive free windows with the protected lunch hour removed. */
  freeSlots: PlannerFreeSlot[]
  capacity: {
    totalFreeMinutes: number
    byDay: Record<string, number>
  }
  lunch: { start: string; end: string; protected: boolean }
}

export interface PlannerStudyPathInfo {
  track: LearningTrack
  items: Array<
    Pick<
      EducationItem,
      | 'id'
      | 'title'
      | 'type'
      | 'status'
      | 'progress'
      | 'targetMinutes'
      | 'dueDate'
    >
  >
  openTasks: number
  overdueTasks: number
  completedTasks: number
  /** Total estimated minutes of the path's open tasks. */
  scheduledMinutes: number
  overdue: EducationTask[]
}

export interface PlannerDeadline {
  track: LearningTrack
  itemId: string
  title: string
  dueDate: string
}

export interface PlannerContext {
  now: string
  todayKey: string
  from: string
  to: string
  openTasks: EducationTask[]
  overdueTasks: EducationTask[]
  weekPlan: EducationTask[]
  availability: AvailabilityReport
  studyPaths: PlannerStudyPathInfo[]
  deadlines: PlannerDeadline[]
  summary: {
    freeMinutes: number
    plannedMinutes: number
    overdueCount: number
    openCount: number
  }
}

const ACTIVE_TIMELINE_STATUSES = new Set([
  'planned',
  'in_progress',
  'paused',
  'rolled_over',
])
const OPEN_EDUCATION_STATUSES = new Set(['pending', 'in_progress', 'paused'])

interface MetaRecordLike {
  key: string
  value: string
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertDateKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isDateKey(value)) {
    throw new PlannerError(
      'invalid_args',
      `${label} must be a YYYY-MM-DD day key`
    )
  }
  return value
}

function assertClock(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isClockTime(value)) {
    throw new PlannerError(
      'invalid_args',
      `${label} must be a 24-hour HH:MM time`
    )
  }
  return value
}

function assertWeekday(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 6
  ) {
    throw new PlannerError(
      'invalid_args',
      'weekday must be an integer between 0 (Saturday) and 6 (Friday)'
    )
  }
  return value
}

function assertMinutes(value: unknown, label: string, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new PlannerError(
      'invalid_args',
      `${label} must be a whole number of minutes between 1 and ${max}`
    )
  }
  return value
}

function assertTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PlannerError('invalid_args', 'title is required')
  }
  return value.trim()
}

function validateAvailabilityInput(input: PlannerAvailabilityInput): void {
  if (!PLANNER_AVAILABILITY_KINDS.includes(input.kind)) {
    throw new PlannerError('invalid_args', 'kind must be "busy" or "free"')
  }
  assertTitle(input.title)
  const hasWeekday = input.weekday !== undefined
  const hasDateKey = input.dateKey !== undefined
  if (hasWeekday === hasDateKey) {
    throw new PlannerError(
      'invalid_args',
      'exactly one of weekday or dateKey is required'
    )
  }
  if (hasWeekday) assertWeekday(input.weekday)
  if (hasDateKey) assertDateKey(input.dateKey, 'dateKey')
  const start = assertClock(input.startClock, 'startClock')
  const end = assertClock(input.endClock, 'endClock')
  if (end <= start) {
    throw new PlannerError(
      'invalid_args',
      'endClock must be later than startClock'
    )
  }
}

function buildAvailability(
  input: PlannerAvailabilityInput,
  base: PlannerAvailability | undefined,
  nowMs: number
): PlannerAvailability {
  validateAvailabilityInput(input)
  const nowIso = new Date(nowMs).toISOString()
  const weekday =
    input.weekday !== undefined ? assertWeekday(input.weekday) : undefined
  const dateKey =
    input.dateKey !== undefined
      ? assertDateKey(input.dateKey, 'dateKey')
      : undefined
  return {
    id: base?.id ?? input.id ?? createId('planner-avail'),
    kind: input.kind,
    title: assertTitle(input.title),
    ...(weekday !== undefined ? { weekday } : {}),
    ...(dateKey !== undefined ? { dateKey } : {}),
    startClock: input.startClock,
    endClock: input.endClock,
    createdAt: base?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }
}

/** Converts a `dateKey + HH:MM + minutes` plan entry into a real interval. */
function entryWindowToInterval(
  dateKey: string,
  time: string,
  estimatedMinutes: number
): PlannerInterval | null {
  const start = clockDateFromParts(dateKey, time)
  if (!start) return null
  const end = new Date(start.getTime() + estimatedMinutes * 60_000)
  return { startTime: start.toISOString(), endTime: end.toISOString() }
}

function parseInterval(interval: PlannerInterval): {
  start: number
  end: number
} {
  const start = Date.parse(interval.startTime)
  const end = Date.parse(interval.endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new PlannerError(
      'invalid_args',
      'interval must have valid start/end timestamps'
    )
  }
  return { start, end }
}

export function overlapsInterval(
  a: PlannerInterval,
  b: PlannerInterval
): boolean {
  const first = parseInterval(a)
  const second = parseInterval(b)
  return first.start < second.end && first.end > second.start
}

function validatePlanEntry(entry: PlannerWeekPlanEntry): void {
  if (!isLearningTrack(entry.track)) {
    throw new PlannerError(
      'invalid_args',
      'track must be masters, university or course'
    )
  }
  assertTitle(entry.title)
  if (!isTaskPriority(entry.priority)) {
    throw new PlannerError(
      'invalid_args',
      'priority must be low, medium, high or urgent'
    )
  }
  assertDateKey(entry.dateKey, 'dateKey')
  assertClock(entry.time, 'time')
  assertMinutes(entry.estimatedMinutes, 'estimatedMinutes', 720)
}

// ---------------------------------------------------------------------------
// Request idempotency
// ---------------------------------------------------------------------------

function requestMetaKey(requestId: string): string {
  return `planner-request-${requestId}`
}

async function readRequestResult(
  requestId: string
): Promise<unknown | undefined> {
  const db = await getDatabase()
  const record = await getRecord<MetaRecordLike>(
    db,
    STORE_META,
    requestMetaKey(requestId)
  )
  if (!record) return undefined
  try {
    return JSON.parse(record.value) as unknown
  } catch {
    return undefined
  }
}

async function writeRequestResult(
  requestId: string,
  result: unknown
): Promise<void> {
  const db = await getDatabase()
  await putRecords<MetaRecordLike>(db, STORE_META, [
    { key: requestMetaKey(requestId), value: JSON.stringify(result) },
  ])
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export async function getPlannerAvailability(): Promise<PlannerAvailability[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<PlannerAvailability>(
    db,
    STORE_PLANNER_AVAILABILITY
  )
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getPlannerAvailabilityById(
  id: string
): Promise<PlannerAvailability | undefined> {
  const db = await getDatabase()
  return getRecord<PlannerAvailability>(db, STORE_PLANNER_AVAILABILITY, id)
}

export async function savePlannerAvailability(
  entries: PlannerAvailabilityInput[],
  requestId?: string,
  nowMs = Date.now()
): Promise<{
  saved: PlannerAvailability[]
  duplicate?: boolean
  requestId?: string
}> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous) {
      return {
        duplicate: true,
        requestId,
        ...(previous as { saved: PlannerAvailability[] }),
      }
    }
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PlannerError(
      'invalid_args',
      'at least one availability entry is required'
    )
  }
  const db = await getDatabase()
  const saved: PlannerAvailability[] = []
  for (const input of entries) {
    validateAvailabilityInput(input)
    const base = input.id
      ? await getRecord<PlannerAvailability>(
          db,
          STORE_PLANNER_AVAILABILITY,
          input.id
        )
      : undefined
    const record = buildAvailability(input, base, nowMs)
    await putRecords(db, STORE_PLANNER_AVAILABILITY, [record])
    saved.push(record)
  }
  if (requestId) await writeRequestResult(requestId, { saved })
  return { saved, requestId }
}

export async function deletePlannerAvailability(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_PLANNER_AVAILABILITY, [id])
}

/** Expands recurring (weekday) and one-off (dateKey) blocks inside the range. */
export function expandAvailabilityBlocks(
  fromKey: string,
  toKey: string,
  blocks: PlannerAvailability[],
  kind?: PlannerAvailabilityKind
): Array<PlannerInterval & { title?: string }> {
  const intervals: Array<PlannerInterval & { title?: string }> = []
  for (const key of listDateKeys(fromKey, toKey)) {
    const weekday = weekdayOfDateKey(key)
    for (const block of blocks) {
      if (kind !== undefined && block.kind !== kind) continue
      if (
        block.weekday !== undefined
          ? block.weekday !== weekday
          : block.dateKey !== key
      ) {
        continue
      }
      const start = clockDateFromParts(key, block.startClock)
      const end = clockDateFromParts(key, block.endClock)
      if (start && end) {
        intervals.push({
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          title: block.title,
        })
      }
    }
  }
  return intervals
}

// ---------------------------------------------------------------------------
// Busy / free computation
// ---------------------------------------------------------------------------

/**
 * Every committed interval in the range: active timeline blocks (classes,
 * gym, work, …), open education tasks and declared busy windows.
 */
export async function collectBusyIntervals(
  from: DateInput,
  to: DateInput
): Promise<PlannerBusyInterval[]> {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  const [availability, blocks, tasks] = await Promise.all([
    getPlannerAvailability(),
    getTimelineBlocksByRange(fromKey, toKey),
    getEducationTasks(),
  ])
  const intervals: PlannerBusyInterval[] = []
  for (const block of blocks) {
    if (!ACTIVE_TIMELINE_STATUSES.has(block.status)) continue
    intervals.push({
      startTime: block.startTime,
      endTime: block.endTime,
      source: 'timeline',
      title: block.title,
    })
  }
  for (const task of tasks) {
    if (!OPEN_EDUCATION_STATUSES.has(task.status)) continue
    if (task.dateKey < fromKey || task.dateKey > toKey) continue
    const window = entryWindowToInterval(
      task.dateKey,
      task.time,
      task.estimatedMinutes
    )
    if (!window) continue
    intervals.push({ ...window, source: 'education', title: task.title })
  }
  for (const interval of expandAvailabilityBlocks(
    fromKey,
    toKey,
    availability,
    'busy'
  )) {
    intervals.push({
      startTime: interval.startTime,
      endTime: interval.endTime,
      source: 'availability',
      ...(interval.title ? { title: interval.title } : {}),
    })
  }
  return intervals
}

/**
 * Consecutive free windows in the range, per local day, with the protected
 * lunch hour (13:00–14:00) removed by default. Busy intervals outside the
 * configured day window (08:00–21:00 by default) are clipped to it.
 */
export function listFreeSlots(
  from: DateInput,
  to: DateInput,
  busy: PlannerInterval[],
  options: PlannerSlotOptions = {}
): PlannerFreeSlot[] {
  const dayStartHour = options.dayStartHour ?? 8
  const dayEndHour = options.dayEndHour ?? 21
  const minSlotMinutes = options.minSlotMinutes ?? 30
  const protectLunch = options.protectLunch ?? true
  const lunchStart = options.lunchStart ?? PLANNER_LUNCH_START
  const lunchEnd = options.lunchEnd ?? PLANNER_LUNCH_END
  if (
    !Number.isFinite(dayStartHour) ||
    !Number.isFinite(dayEndHour) ||
    dayEndHour <= dayStartHour
  ) {
    throw new PlannerError(
      'invalid_args',
      'the day window must be a valid start/end hour'
    )
  }
  if (!Number.isFinite(minSlotMinutes) || minSlotMinutes < 1) {
    throw new PlannerError(
      'invalid_args',
      'minSlotMinutes must be a positive number'
    )
  }

  const slots: PlannerFreeSlot[] = []
  for (const key of listDateKeys(from, to)) {
    const day = fromDateKey(key)
    const windowStart = new Date(day)
    windowStart.setHours(dayStartHour, 0, 0, 0)
    const windowEnd = new Date(day)
    windowEnd.setHours(dayEndHour, 0, 0, 0)

    const dayBusy: PlannerInterval[] = []
    if (protectLunch) {
      const lunch = entryWindowToInterval(
        key,
        lunchStart,
        (Date.parse(`${key}T${lunchEnd}:00`) -
          Date.parse(`${key}T${lunchStart}:00`)) /
          60_000
      )
      if (lunch) dayBusy.push(lunch)
    }
    for (const interval of busy) {
      let start = Date.parse(interval.startTime)
      let end = Date.parse(interval.endTime)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      start = Math.max(start, windowStart.getTime())
      end = Math.min(end, windowEnd.getTime())
      if (end > start) {
        dayBusy.push({
          startTime: new Date(start).toISOString(),
          endTime: new Date(end).toISOString(),
        })
      }
    }
    dayBusy.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))

    const merged: PlannerInterval[] = []
    for (const interval of dayBusy) {
      const last = merged[merged.length - 1]
      if (last && Date.parse(interval.startTime) <= Date.parse(last.endTime)) {
        if (Date.parse(interval.endTime) > Date.parse(last.endTime))
          last.endTime = interval.endTime
      } else {
        merged.push({ ...interval })
      }
    }

    let cursor = windowStart.getTime()
    const pushSlot = (until: number): void => {
      if (until <= cursor) return
      const minutes = Math.floor((until - cursor) / 60_000)
      if (minutes >= minSlotMinutes) {
        slots.push({
          dateKey: key,
          startTime: new Date(cursor).toISOString(),
          endTime: new Date(until).toISOString(),
          minutes,
        })
      }
    }
    for (const interval of merged) {
      pushSlot(Date.parse(interval.startTime))
      cursor = Math.max(cursor, Date.parse(interval.endTime))
    }
    pushSlot(windowEnd.getTime())
  }
  return slots
}

export async function getAvailabilityReport(
  from: DateInput,
  to: DateInput,
  options: PlannerSlotOptions = {}
): Promise<AvailabilityReport> {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  const declared = await getPlannerAvailability()
  const busy = await collectBusyIntervals(fromKey, toKey)
  const freeSlots = listFreeSlots(fromKey, toKey, busy, options)
  const capacity: AvailabilityReport['capacity'] = {
    totalFreeMinutes: 0,
    byDay: {},
  }
  for (const slot of freeSlots) {
    capacity.totalFreeMinutes += slot.minutes
    capacity.byDay[slot.dateKey] =
      (capacity.byDay[slot.dateKey] ?? 0) + slot.minutes
  }
  return {
    from: fromKey,
    to: toKey,
    declared,
    declaredBusy: expandAvailabilityBlocks(fromKey, toKey, declared, 'busy'),
    declaredFree: expandAvailabilityBlocks(fromKey, toKey, declared, 'free'),
    busy,
    freeSlots,
    capacity,
    lunch: {
      start: options.lunchStart ?? PLANNER_LUNCH_START,
      end: options.lunchEnd ?? PLANNER_LUNCH_END,
      protected: options.protectLunch ?? true,
    },
  }
}

// ---------------------------------------------------------------------------
// Reads: tasks, week plan, study paths, context
// ---------------------------------------------------------------------------

function isEducationTaskOverdue(
  task: EducationTask,
  todayKey: string
): boolean {
  return task.status !== 'completed' && task.dateKey < todayKey
}

function isWorkBlockOverdue(
  block: TimelineBlockRecord,
  todayKey: string,
  nowMs: number
): boolean {
  return (
    ACTIVE_TIMELINE_STATUSES.has(block.status) &&
    (block.dateKey < todayKey || Date.parse(block.endTime) <= nowMs)
  )
}

export async function getPlannerTasks(
  filters: PlannerTaskFilters = {},
  now = new Date()
): Promise<PlannerTaskEntry[]> {
  const todayKey = toDateKey(now)
  const nowMs = now.getTime()
  const fromKey = filters.dateFrom ?? '0000-00-00'
  const toKey = filters.dateTo ?? '9999-99-99'
  // Timeline blocks are queried with valid date bounds even when the caller
  // did not filter by date; the string bounds above still filter the result.
  const [tasks, blocks] = await Promise.all([
    getEducationTasks(),
    getTimelineBlocksByRange(
      filters.dateFrom ?? '1970-01-01',
      filters.dateTo ?? '9999-12-31'
    ),
  ])

  const entries: PlannerTaskEntry[] = []
  for (const task of tasks) {
    if (task.dateKey < fromKey || task.dateKey > toKey) continue
    if (filters.status !== undefined && task.status !== filters.status) continue
    if (filters.priority !== undefined && task.priority !== filters.priority)
      continue
    if (filters.track !== undefined && task.track !== filters.track) continue
    const overdue = isEducationTaskOverdue(task, todayKey)
    if (filters.overdue !== undefined && overdue !== filters.overdue) continue
    entries.push({
      kind: 'education',
      id: task.id,
      title: task.title,
      ...(task.track ? { track: task.track } : {}),
      ...(task.courseId ? { courseId: task.courseId } : {}),
      dateKey: task.dateKey,
      time: task.time,
      estimatedMinutes: task.estimatedMinutes,
      status: task.status,
      priority: task.priority,
      overdue,
      ...(task.plannerManaged ? { plannerManaged: true } : {}),
    })
  }
  for (const block of blocks) {
    if (block.category !== 'work' && block.category !== 'freelance') continue
    // Work blocks have no education path; a track filter selects tasks only.
    if (filters.track !== undefined) continue
    if (filters.status !== undefined && block.status !== filters.status)
      continue
    if (filters.priority !== undefined && block.priority !== filters.priority)
      continue
    const overdue = isWorkBlockOverdue(block, todayKey, nowMs)
    if (filters.overdue !== undefined && overdue !== filters.overdue) continue
    entries.push({
      kind: 'work',
      id: block.id,
      title: block.title,
      dateKey: block.dateKey,
      time: clockTimeFromDate(new Date(block.startTime)),
      startTime: block.startTime,
      endTime: block.endTime,
      estimatedMinutes: Math.max(1, Math.round(block.durationMinutes)),
      status: block.status,
      ...(block.priority ? { priority: block.priority } : {}),
      overdue,
    })
  }
  return entries.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.time.localeCompare(b.time)
  )
}

/** Open tasks with a scheduled day earlier than today. */
export async function getOverdueEducationTasks(
  now = new Date()
): Promise<EducationTask[]> {
  const todayKey = toDateKey(now)
  const tasks = await getEducationTasks()
  return tasks.filter((task) => isEducationTaskOverdue(task, todayKey))
}

/** The education tasks scheduled inside the range — the current "week plan". */
export async function getWeekPlan(
  from: DateInput,
  to: DateInput
): Promise<EducationTask[]> {
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  const tasks = await getEducationTasks()
  return tasks
    .filter((task) => task.dateKey >= fromKey && task.dateKey <= toKey)
    .sort(
      (a, b) =>
        a.dateKey.localeCompare(b.dateKey) || a.time.localeCompare(b.time)
    )
}

export async function getStudyPaths(
  now = new Date()
): Promise<PlannerStudyPathInfo[]> {
  const todayKey = toDateKey(now)
  const [items, tasks] = await Promise.all([
    getEducationItems(),
    getEducationTasks(),
  ])
  const tracks: LearningTrack[] = ['masters', 'university', 'course']
  return tracks.map((track) => {
    const trackItems = items.filter((item) => item.track === track)
    const trackTasks = tasks.filter((task) => task.track === track)
    const open = trackTasks.filter((task) =>
      OPEN_EDUCATION_STATUSES.has(task.status)
    )
    const overdue = open.filter((task) =>
      isEducationTaskOverdue(task, todayKey)
    )
    return {
      track,
      items: trackItems.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        progress: item.progress,
        ...(item.targetMinutes !== undefined
          ? { targetMinutes: item.targetMinutes }
          : {}),
        ...(item.dueDate !== undefined ? { dueDate: item.dueDate } : {}),
      })),
      openTasks: open.length,
      overdueTasks: overdue.length,
      completedTasks: trackTasks.filter((task) => task.status === 'completed')
        .length,
      scheduledMinutes: open.reduce(
        (total, task) => total + task.estimatedMinutes,
        0
      ),
      overdue,
    }
  })
}

export interface PlannerContextOptions {
  from?: DateInput
  to?: DateInput
  now?: Date
  slotOptions?: PlannerSlotOptions
}

/** Everything the agent needs to build or revise a plan, in one request. */
export async function getPlannerContext(
  options: PlannerContextOptions = {}
): Promise<PlannerContext> {
  const now = options.now ?? new Date()
  const todayKey = toDateKey(now)
  const fromKey = toDateKey(options.from ?? todayKey)
  const toKey = toDateKey(
    options.to ??
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 13)
  )
  const [availability, openTasks, overdueTasks, weekPlan, studyPaths, items] =
    await Promise.all([
      getAvailabilityReport(fromKey, toKey, options.slotOptions),
      getEducationTasks().then((tasks) =>
        tasks.filter((task) => task.status !== 'completed')
      ),
      getOverdueEducationTasks(now),
      getWeekPlan(fromKey, toKey),
      getStudyPaths(now),
      getEducationItems(),
    ])
  const deadlines: PlannerDeadline[] = items
    .filter((item) => item.status !== 'completed' && item.dueDate !== undefined)
    .map((item) => ({
      track: item.track,
      itemId: item.id,
      title: item.title,
      dueDate: item.dueDate as string,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return {
    now: now.toISOString(),
    todayKey,
    from: fromKey,
    to: toKey,
    openTasks,
    overdueTasks,
    weekPlan,
    availability,
    studyPaths,
    deadlines,
    summary: {
      freeMinutes: availability.capacity.totalFreeMinutes,
      plannedMinutes: weekPlan
        .filter((task) => task.status !== 'completed')
        .reduce((total, task) => total + task.estimatedMinutes, 0),
      overdueCount: overdueTasks.length,
      openCount: openTasks.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Writes: week plan, tasks, rescheduling, deletion
// ---------------------------------------------------------------------------

interface ConflictCheck {
  intervals: PlannerBusyInterval[]
  occupied: PlannerInterval[]
}

async function loadConflictSources(
  entries: Array<{ dateKey: string }>
): Promise<ConflictCheck> {
  const keys = entries
    .map((entry) => entry.dateKey)
    .filter((key) => isDateKey(key))
  if (keys.length === 0) return { intervals: [], occupied: [] }
  const fromKey = [...keys].sort()[0] as string
  const toKey = [...keys].sort()[keys.length - 1] as string
  const intervals = await collectBusyIntervals(fromKey, toKey)
  return { intervals, occupied: [] }
}

function findEntryConflict(
  window: PlannerInterval,
  sources: ConflictCheck
): PlannerBusyInterval | PlannerInterval | undefined {
  for (const interval of sources.intervals) {
    if (overlapsInterval(window, interval)) return interval
  }
  for (const interval of sources.occupied) {
    if (overlapsInterval(window, interval)) return interval
  }
  return undefined
}

function describeConflict(
  conflict: PlannerBusyInterval | PlannerInterval
): string {
  const start = new Date(conflict.startTime)
  const end = new Date(conflict.endTime)
  const time = `${start.toISOString()} – ${end.toISOString()}`
  if ('source' in conflict && 'title' in conflict && conflict.title) {
    return `overlaps ${conflict.source} "${conflict.title}" (${time})`
  }
  if ('source' in conflict)
    return `overlaps a ${conflict.source} interval (${time})`
  return `overlaps another entry of this plan (${time})`
}

function validatePlanEntrySafe(
  entry: PlannerWeekPlanEntry
): PlannerError | undefined {
  try {
    validatePlanEntry(entry)
    return undefined
  } catch (error) {
    return error instanceof PlannerError
      ? error
      : new PlannerError('invalid_args', 'invalid plan entry')
  }
}

/**
 * Creates (or, for entries with an existing id, updates) plan entries after
 * checking each one against busy sources, the protected lunch hour and the
 * other entries of the same batch. Returns what was saved and what failed;
 * a batch never partially overwrites itself, so retrying with the same
 * requestId returns the stored outcome instead of creating duplicates.
 */
export async function createWeekPlan(
  entries: PlannerWeekPlanEntry[],
  requestId?: string,
  nowMs = Date.now()
): Promise<CreateWeekPlanResult> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous)
      return {
        created: [],
        failed: [],
        duplicate: true,
        requestId,
        ...(previous as object),
      }
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PlannerError(
      'invalid_args',
      'at least one plan entry is required'
    )
  }
  if (entries.length > 300) {
    throw new PlannerError(
      'invalid_args',
      'a plan can contain at most 300 entries'
    )
  }

  const failed: PlannerWriteFailure[] = []
  const valid: PlannerWeekPlanEntry[] = []
  entries.forEach((entry, index) => {
    const error = validatePlanEntrySafe(entry)
    if (error)
      failed.push({
        index,
        id: entry.id,
        code: error.code,
        message: error.message,
      })
    else valid.push(entry)
  })

  const sources = await loadConflictSources(valid)
  const created: EducationTask[] = []

  for (let position = 0; position < valid.length; position += 1) {
    const entry = valid[position] as PlannerWeekPlanEntry
    const window = entryWindowToInterval(
      entry.dateKey,
      entry.time,
      entry.estimatedMinutes
    )
    if (!window) {
      failed.push({
        index: entries.indexOf(entry),
        id: entry.id,
        code: 'invalid_args',
        message: 'entry date/time is invalid',
      })
      continue
    }
    // Upserting an entry with an existing id must not conflict with the
    // record it is about to update.
    let excludeWindow: PlannerInterval | undefined
    if (entry.id) {
      const existing = await getEducationTask(entry.id)
      if (existing) {
        excludeWindow =
          entryWindowToInterval(
            existing.dateKey,
            existing.time,
            existing.estimatedMinutes
          ) ?? undefined
      }
    }
    const candidateSources: ConflictCheck = excludeWindow
      ? {
          intervals: sources.intervals.filter(
            (interval) =>
              !(
                interval.source === 'education' &&
                interval.startTime === excludeWindow?.startTime &&
                interval.endTime === excludeWindow?.endTime
              )
          ),
          occupied: sources.occupied,
        }
      : sources
    const conflict = findEntryConflict(window, candidateSources)
    if (conflict) {
      failed.push({
        index: entries.indexOf(entry),
        id: entry.id,
        code: 'conflict',
        message: describeConflict(conflict),
      })
      continue
    }
    try {
      const saved = await saveEducationTask(
        { ...entry, plannerManaged: true },
        nowMs
      )
      sources.occupied.push({
        startTime: window.startTime,
        endTime: window.endTime,
      })
      created.push(saved)
    } catch (error) {
      failed.push({
        index: entries.indexOf(entry),
        id: entry.id,
        code: error instanceof PlannerError ? error.code : 'internal',
        message:
          error instanceof Error
            ? error.message
            : 'failed to save the plan entry',
      })
    }
  }

  if (requestId) await writeRequestResult(requestId, { created, failed })
  return { created, failed, requestId }
}

/** Creates one education task through the same validation as a week plan. */
export async function createPlannerTask(
  entry: PlannerWeekPlanEntry,
  requestId?: string,
  nowMs = Date.now()
): Promise<{
  created: EducationTask
  duplicate?: boolean
  requestId?: string
}> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous) {
      return {
        duplicate: true,
        requestId,
        ...(previous as { created: EducationTask }),
      }
    }
  }
  const error = validatePlanEntrySafe(entry)
  if (error) throw error
  const sources = await loadConflictSources([entry])
  const window = entryWindowToInterval(
    entry.dateKey,
    entry.time,
    entry.estimatedMinutes
  )
  if (!window)
    throw new PlannerError('invalid_args', 'entry date/time is invalid')
  const conflict = findEntryConflict(window, sources)
  if (conflict)
    throw new PlannerError('conflict', describeConflict(conflict), conflict)
  const saved = await saveEducationTask(
    { ...entry, plannerManaged: true },
    nowMs
  )
  if (requestId) await writeRequestResult(requestId, { created: saved })
  return { created: saved, requestId }
}

function mergeTaskPatch(
  task: EducationTask,
  patch: PlannerTaskPatch
): PlannerWeekPlanEntry {
  const merged: PlannerWeekPlanEntry = {
    id: task.id,
    track: patch.track ?? task.track,
    title: patch.title ?? task.title,
    priority: patch.priority ?? task.priority,
    dateKey: patch.dateKey ?? task.dateKey,
    time: patch.time ?? task.time,
    estimatedMinutes: patch.estimatedMinutes ?? task.estimatedMinutes,
  }
  const courseId = patch.courseId !== undefined ? patch.courseId : task.courseId
  const description =
    patch.description !== undefined ? patch.description : task.description
  if (courseId) merged.courseId = courseId
  if (description) merged.description = description
  return merged
}

/**
 * Applies per-task changes (move, resize, rename, …) with the same conflict
 * checks as creation. Completed tasks and tasks with a running timer are
 * rejected; every other education task may be rescheduled by the agent.
 */
export async function updateWeekPlan(
  changes: PlannerTaskChange[],
  requestId?: string,
  nowMs = Date.now()
): Promise<UpdateWeekPlanResult> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous)
      return {
        updated: [],
        failed: [],
        duplicate: true,
        requestId,
        ...(previous as object),
      }
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new PlannerError('invalid_args', 'at least one change is required')
  }
  if (changes.length > 300) {
    throw new PlannerError(
      'invalid_args',
      'an update can contain at most 300 changes'
    )
  }

  const failed: PlannerWriteFailure[] = []
  const updated: EducationTask[] = []
  const occupied: PlannerInterval[] = []

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index] as PlannerTaskChange
    const base = await getEducationTask(change.id)
    if (!base) {
      failed.push({
        index,
        id: change.id,
        code: 'not_found',
        message: `education task "${change.id}" does not exist`,
      })
      continue
    }
    if (base.status === 'completed') {
      failed.push({
        index,
        id: change.id,
        code: 'invalid_args',
        message: 'a completed task can not be modified',
      })
      continue
    }
    if (base.timerStartedAt) {
      failed.push({
        index,
        id: change.id,
        code: 'busy_timer',
        message: 'the task timer is running; pause it before rescheduling',
      })
      continue
    }
    const merged = mergeTaskPatch(base, change.patch)
    const error = validatePlanEntrySafe(merged)
    if (error) {
      failed.push({
        index,
        id: change.id,
        code: error.code,
        message: error.message,
      })
      continue
    }
    const window = entryWindowToInterval(
      merged.dateKey,
      merged.time,
      merged.estimatedMinutes
    )
    if (!window) {
      failed.push({
        index,
        id: change.id,
        code: 'invalid_args',
        message: 'the new date/time is invalid',
      })
      continue
    }
    // The task's own current interval is a busy source; exclude it so a move
    // can never "conflict" with the task being moved.
    const oldWindow = entryWindowToInterval(
      base.dateKey,
      base.time,
      base.estimatedMinutes
    )
    const sources = await loadConflictSources([merged])
    const intervals = oldWindow
      ? sources.intervals.filter(
          (interval) =>
            !(
              interval.source === 'education' &&
              interval.startTime === oldWindow.startTime &&
              interval.endTime === oldWindow.endTime &&
              interval.title === base.title
            )
        )
      : sources.intervals
    const conflict = findEntryConflict(window, { intervals, occupied })
    if (conflict) {
      failed.push({
        index,
        id: change.id,
        code: 'conflict',
        message: describeConflict(conflict),
      })
      continue
    }
    try {
      const saved = await saveEducationTask(
        {
          id: base.id,
          track: merged.track,
          title: merged.title,
          ...(merged.courseId !== undefined
            ? { courseId: merged.courseId }
            : {}),
          ...(merged.description !== undefined
            ? { description: merged.description }
            : {}),
          priority: merged.priority,
          dateKey: merged.dateKey,
          time: merged.time,
          estimatedMinutes: merged.estimatedMinutes,
          status: base.status,
        },
        nowMs
      )
      occupied.push({ startTime: window.startTime, endTime: window.endTime })
      updated.push(saved)
    } catch (saveError) {
      failed.push({
        index,
        id: change.id,
        code: saveError instanceof PlannerError ? saveError.code : 'internal',
        message:
          saveError instanceof Error
            ? saveError.message
            : 'failed to save the change',
      })
    }
  }

  if (requestId) await writeRequestResult(requestId, { updated, failed })
  return { updated, failed, requestId }
}

/**
 * Moves one task to a new day/time (and optionally resizes it). Throws a
 * structured `PlannerError` when the move is impossible.
 */
export async function reschedulePlannerTask(
  id: string,
  patch: { dateKey: string; time: string; estimatedMinutes?: number },
  requestId?: string,
  nowMs = Date.now()
): Promise<{
  updated: EducationTask
  duplicate?: boolean
  requestId?: string
}> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous) {
      return {
        duplicate: true,
        requestId,
        ...(previous as { updated: EducationTask }),
      }
    }
  }
  const change: PlannerTaskChange = { id, patch }
  const result = await updateWeekPlan([change], undefined, nowMs)
  const failure = result.failed[0]
  if (failure) throw new PlannerError(failure.code, failure.message)
  const saved = result.updated[0] as EducationTask
  if (requestId) await writeRequestResult(requestId, { updated: saved })
  return { updated: saved, requestId }
}

/**
 * Deletes exactly one planner-managed item. Education tasks are only deleted
 * when the agent created them (`plannerManaged`); availability blocks are
 * planner-scoped by definition. Everything else is out of scope and rejected.
 */
export async function deletePlannerItem(
  kind: 'task' | 'availability',
  id: string,
  requestId?: string
): Promise<{
  deleted: { kind: string; id: string }
  duplicate?: boolean
  requestId?: string
}> {
  if (requestId) {
    const previous = await readRequestResult(requestId)
    if (previous) return { deleted: { kind, id }, duplicate: true, requestId }
  }
  if (kind === 'task') {
    const task = await getEducationTask(id)
    if (!task)
      throw new PlannerError(
        'not_found',
        `education task "${id}" does not exist`
      )
    if (!task.plannerManaged) {
      throw new PlannerError(
        'forbidden',
        `education task "${id}" was not created by the planner agent and can not be deleted by it`
      )
    }
    if (task.timerStartedAt) {
      throw new PlannerError(
        'busy_timer',
        'the task timer is running; pause it before deleting'
      )
    }
    await deleteEducationTask(id)
  } else if (kind === 'availability') {
    const block = await getPlannerAvailabilityById(id)
    if (!block)
      throw new PlannerError(
        'not_found',
        `availability block "${id}" does not exist`
      )
    await deletePlannerAvailability(id)
  } else {
    throw new PlannerError(
      'invalid_args',
      'kind must be "task" or "availability"'
    )
  }
  if (requestId) await writeRequestResult(requestId, { deleted: { kind, id } })
  return { deleted: { kind, id }, requestId }
}
