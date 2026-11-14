/**
 * Gym module data service.
 *
 * Weekly plans, their exercises and the real performance sessions live in
 * dedicated IndexedDB stores (schema v12). Plan records and performance
 * history are independent: editing or deleting a plan never touches the
 * sessions and sets that were already logged.
 */
import {
  isGymWeekday,
  weekdayOfDateKey,
  type GymWeekday,
} from '@/lib/gym-weekdays'
import { createId } from '@/lib/id'
import { getDatabase } from '@/services/db'
import {
  awaitTransaction,
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  promisifyRequest,
  putRecords,
} from '@/services/idb'
import {
  STORE_GYM_EXERCISES,
  STORE_GYM_PLANS,
  STORE_GYM_SESSION_SETS,
  STORE_GYM_SESSIONS,
} from '@/services/stores'

const MAX_LABEL_LENGTH = 100
const MAX_REPS = 500
const MAX_WEIGHT_KG = 1000
const MAX_SET_NUMBER = 100

export interface GymPlan {
  weekday: GymWeekday
  title: string
  updatedAt: string
}

export interface GymExercise {
  id: string
  weekday: GymWeekday
  name: string
  /** Position inside the weekday's plan; lower values come first. */
  order: number
  createdAt: string
  updatedAt: string
}

export type GymSessionStatus = 'draft' | 'done'

export interface GymSession {
  id: string
  dateKey: string
  weekday: GymWeekday
  /** Snapshot of the plan title when the session started. */
  title: string
  status: GymSessionStatus
  startedAt: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface GymSessionSet {
  id: string
  sessionId: string
  exerciseId: string
  /** Name snapshot; history survives exercise renames and deletions. */
  exerciseName: string
  setNumber: number
  reps: number
  weightKg: number
  createdAt: string
}

function assertWeekday(value: unknown, label: string): GymWeekday {
  if (!isGymWeekday(value)) {
    throw new RangeError(`${label} must be a weekday between 0 and 6`)
  }
  return value
}

function assertLabel(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new RangeError(`${label} must not be empty`)
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new RangeError(
      `${label} must be at most ${MAX_LABEL_LENGTH} characters`
    )
  }
  return trimmed
}

function assertReps(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_REPS) {
    throw new RangeError(
      `reps must be a whole number between 1 and ${MAX_REPS}`
    )
  }
  return value
}

function assertWeightKg(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_WEIGHT_KG) {
    throw new RangeError(
      `weightKg must be between 0 and ${MAX_WEIGHT_KG} kilograms`
    )
  }
  return value
}

function assertSetNumber(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SET_NUMBER) {
    throw new RangeError(
      `setNumber must be a whole number between 1 and ${MAX_SET_NUMBER}`
    )
  }
  return value
}

function assertDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('dateKey must use yyyy-MM-dd')
  }
  return value
}

function sortByOrder(exercises: GymExercise[]): GymExercise[] {
  return [...exercises].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)
  )
}

// ---------------------------------------------------------------------------
// Weekly plans
// ---------------------------------------------------------------------------

export async function getGymPlans(): Promise<GymPlan[]> {
  const database = await getDatabase()
  const plans = await getAllRecords<GymPlan>(database, STORE_GYM_PLANS)
  return [...plans].sort((a, b) => a.weekday - b.weekday)
}

export async function getGymPlan(
  weekday: GymWeekday
): Promise<GymPlan | undefined> {
  assertWeekday(weekday, 'weekday')
  const database = await getDatabase()
  return getRecord<GymPlan>(database, STORE_GYM_PLANS, weekday)
}

export async function saveGymPlan(
  weekday: GymWeekday,
  title: string
): Promise<GymPlan> {
  assertWeekday(weekday, 'weekday')
  const plan: GymPlan = {
    weekday,
    title: assertLabel(title, 'title'),
    updatedAt: new Date().toISOString(),
  }
  const database = await getDatabase()
  await putRecords(database, STORE_GYM_PLANS, [plan])
  return plan
}

/**
 * Removes the weekday's plan together with its exercises in one transaction.
 * Logged sessions and sets of that weekday are intentionally left untouched.
 */
export async function deleteGymPlan(weekday: GymWeekday): Promise<void> {
  assertWeekday(weekday, 'weekday')
  const database = await getDatabase()
  const tx = database.transaction(
    [STORE_GYM_PLANS, STORE_GYM_EXERCISES],
    'readwrite'
  )
  const complete = awaitTransaction(tx)
  try {
    tx.objectStore(STORE_GYM_PLANS).delete(weekday)
    const exercises = await promisifyRequest<GymExercise[]>(
      tx.objectStore(STORE_GYM_EXERCISES).index('by_weekday').getAll(weekday)
    )
    for (const exercise of exercises) {
      tx.objectStore(STORE_GYM_EXERCISES).delete(exercise.id)
    }
    await complete
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export async function getGymExercises(
  weekday: GymWeekday
): Promise<GymExercise[]> {
  assertWeekday(weekday, 'weekday')
  const database = await getDatabase()
  const exercises = await getAllFromIndex<GymExercise>(
    database,
    STORE_GYM_EXERCISES,
    'by_weekday',
    weekday
  )
  return sortByOrder(exercises)
}

/** Every plan exercise across all weekdays, sorted by weekday then order. */
export async function getAllGymExercises(): Promise<GymExercise[]> {
  const database = await getDatabase()
  const exercises = await getAllRecords<GymExercise>(
    database,
    STORE_GYM_EXERCISES
  )
  return [...exercises].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt)
  )
}

export async function saveGymExercise(input: {
  weekday: GymWeekday
  name: string
}): Promise<GymExercise> {
  const weekday = assertWeekday(input.weekday, 'weekday')
  const name = assertLabel(input.name, 'name')
  const database = await getDatabase()
  const tx = database.transaction(STORE_GYM_EXERCISES, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_GYM_EXERCISES)
    const existing = await promisifyRequest<GymExercise[]>(
      store.index('by_weekday').getAll(weekday)
    )
    const order =
      existing.reduce((max, exercise) => Math.max(max, exercise.order), 0) + 1
    const now = new Date().toISOString()
    const exercise: GymExercise = {
      id: createId('gymex'),
      weekday,
      name,
      order,
      createdAt: now,
      updatedAt: now,
    }
    store.put(exercise)
    await complete
    return exercise
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

export async function updateGymExerciseName(
  id: string,
  name: string
): Promise<GymExercise> {
  const database = await getDatabase()
  const old = await getRecord<GymExercise>(database, STORE_GYM_EXERCISES, id)
  if (!old) throw new RangeError(`Gym exercise "${id}" does not exist`)
  const exercise: GymExercise = {
    ...old,
    name: assertLabel(name, 'name'),
    updatedAt: new Date().toISOString(),
  }
  await putRecords(database, STORE_GYM_EXERCISES, [exercise])
  return exercise
}

/** Swaps the exercise with its previous/next neighbour inside the plan. */
export async function moveGymExercise(
  id: string,
  direction: 'up' | 'down'
): Promise<GymExercise[]> {
  const database = await getDatabase()
  const tx = database.transaction(STORE_GYM_EXERCISES, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_GYM_EXERCISES)
    const target = await promisifyRequest<GymExercise | undefined>(
      store.get(id)
    )
    if (!target) throw new RangeError(`Gym exercise "${id}" does not exist`)
    const siblings = await promisifyRequest<GymExercise[]>(
      store.index('by_weekday').getAll(target.weekday)
    )
    const ordered = sortByOrder(siblings)
    const index = ordered.findIndex((exercise) => exercise.id === id)
    const neighbourIndex = direction === 'up' ? index - 1 : index + 1
    if (
      index === -1 ||
      neighbourIndex < 0 ||
      neighbourIndex >= ordered.length
    ) {
      await complete
      return ordered
    }
    const neighbour = ordered[neighbourIndex]!
    const targetOrder = target.order
    target.order = neighbour.order
    neighbour.order = targetOrder
    store.put(target)
    store.put(neighbour)
    await complete
    return sortByOrder(
      ordered.map((exercise) =>
        exercise.id === target.id
          ? target
          : exercise.id === neighbour.id
            ? neighbour
            : exercise
      )
    )
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

/** Deletes the exercise from the plan only; logged sets stay in history. */
export async function deleteGymExercise(id: string): Promise<void> {
  const database = await getDatabase()
  await deleteRecords(database, STORE_GYM_EXERCISES, [id])
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getGymSessions(): Promise<GymSession[]> {
  const database = await getDatabase()
  const sessions = await getAllRecords<GymSession>(database, STORE_GYM_SESSIONS)
  return [...sessions].sort(
    (a, b) =>
      b.dateKey.localeCompare(a.dateKey) ||
      b.createdAt.localeCompare(a.createdAt)
  )
}

export async function getGymSessionsByDate(
  dateKey: string
): Promise<GymSession[]> {
  assertDateKey(dateKey)
  const database = await getDatabase()
  const sessions = await getAllFromIndex<GymSession>(
    database,
    STORE_GYM_SESSIONS,
    'by_date_key',
    dateKey
  )
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getGymSession(
  id: string
): Promise<GymSession | undefined> {
  const database = await getDatabase()
  return getRecord<GymSession>(database, STORE_GYM_SESSIONS, id)
}

export async function startGymSession(
  dateKey: string,
  title: string
): Promise<GymSession> {
  const key = assertDateKey(dateKey)
  const now = new Date().toISOString()
  const session: GymSession = {
    id: createId('gymsession'),
    dateKey: key,
    weekday: weekdayOfDateKey(key),
    title: assertLabel(title, 'title'),
    status: 'draft',
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  const database = await getDatabase()
  await putRecords(database, STORE_GYM_SESSIONS, [session])
  return session
}

async function assertSessionEditable(
  database: IDBDatabase,
  sessionId: string
): Promise<GymSession> {
  const session = await getRecord<GymSession>(
    database,
    STORE_GYM_SESSIONS,
    sessionId
  )
  if (!session)
    throw new RangeError(`Gym session "${sessionId}" does not exist`)
  if (session.status !== 'draft') {
    throw new RangeError('completed gym sessions cannot be changed')
  }
  return session
}

/**
 * Marks a draft session as done. A session with no sets cannot be completed;
 * delete it instead.
 */
export async function completeGymSession(id: string): Promise<GymSession> {
  const database = await getDatabase()
  const tx = database.transaction(
    [STORE_GYM_SESSIONS, STORE_GYM_SESSION_SETS],
    'readwrite'
  )
  const complete = awaitTransaction(tx)
  try {
    const sessions = tx.objectStore(STORE_GYM_SESSIONS)
    const session = await promisifyRequest<GymSession | undefined>(
      sessions.get(id)
    )
    if (!session) throw new RangeError(`Gym session "${id}" does not exist`)
    if (session.status === 'done') {
      await complete
      return session
    }
    const setCount = await promisifyRequest<number>(
      tx.objectStore(STORE_GYM_SESSION_SETS).index('by_session').count(id)
    )
    if (setCount === 0) {
      throw new RangeError(
        'a gym session needs at least one set to be completed'
      )
    }
    const now = new Date().toISOString()
    const completed: GymSession = {
      ...session,
      status: 'done',
      completedAt: now,
      updatedAt: now,
    }
    sessions.put(completed)
    await complete
    return completed
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

/** Deletes a draft session and its sets; completed history stays untouched. */
export async function deleteGymSession(id: string): Promise<void> {
  const database = await getDatabase()
  const tx = database.transaction(
    [STORE_GYM_SESSIONS, STORE_GYM_SESSION_SETS],
    'readwrite'
  )
  const complete = awaitTransaction(tx)
  try {
    const session = await promisifyRequest<GymSession | undefined>(
      tx.objectStore(STORE_GYM_SESSIONS).get(id)
    )
    if (!session) throw new RangeError(`Gym session "${id}" does not exist`)
    if (session.status !== 'draft') {
      throw new RangeError('completed gym sessions cannot be deleted')
    }
    tx.objectStore(STORE_GYM_SESSIONS).delete(id)
    const sets = await promisifyRequest<GymSessionSet[]>(
      tx.objectStore(STORE_GYM_SESSION_SETS).index('by_session').getAll(id)
    )
    for (const set of sets) {
      tx.objectStore(STORE_GYM_SESSION_SETS).delete(set.id)
    }
    await complete
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export async function getGymSessionSets(
  sessionId: string
): Promise<GymSessionSet[]> {
  const database = await getDatabase()
  const sets = await getAllFromIndex<GymSessionSet>(
    database,
    STORE_GYM_SESSION_SETS,
    'by_session',
    sessionId
  )
  return [...sets].sort(
    (a, b) =>
      a.setNumber - b.setNumber || a.createdAt.localeCompare(b.createdAt)
  )
}

/** Every logged set, sorted by session date for history views. */
export async function getAllGymSessionSets(): Promise<GymSessionSet[]> {
  const database = await getDatabase()
  return getAllRecords<GymSessionSet>(database, STORE_GYM_SESSION_SETS)
}

export async function saveGymSessionSet(input: {
  sessionId: string
  exerciseId: string
  exerciseName: string
  setNumber: number
  reps: number
  weightKg: number
}): Promise<GymSessionSet> {
  const setNumber = assertSetNumber(input.setNumber)
  const database = await getDatabase()
  const tx = database.transaction(
    [STORE_GYM_SESSIONS, STORE_GYM_SESSION_SETS],
    'readwrite'
  )
  const complete = awaitTransaction(tx)
  try {
    const session = await promisifyRequest<GymSession | undefined>(
      tx.objectStore(STORE_GYM_SESSIONS).get(input.sessionId)
    )
    if (!session) {
      throw new RangeError(`Gym session "${input.sessionId}" does not exist`)
    }
    if (session.status !== 'draft') {
      throw new RangeError('completed gym sessions cannot be changed')
    }
    const sets = await promisifyRequest<GymSessionSet[]>(
      tx
        .objectStore(STORE_GYM_SESSION_SETS)
        .index('by_session')
        .getAll(input.sessionId)
    )
    if (
      sets.some(
        (set) =>
          set.exerciseId === input.exerciseId && set.setNumber === setNumber
      )
    ) {
      throw new RangeError(
        'a set with this number already exists for the exercise'
      )
    }
    const record: GymSessionSet = {
      id: createId('gymset'),
      sessionId: input.sessionId,
      exerciseId: input.exerciseId,
      exerciseName: assertLabel(input.exerciseName, 'exerciseName'),
      setNumber,
      reps: assertReps(input.reps),
      weightKg: assertWeightKg(input.weightKg),
      createdAt: new Date().toISOString(),
    }
    tx.objectStore(STORE_GYM_SESSION_SETS).put(record)
    await complete
    return record
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await complete.catch(() => undefined)
    throw error
  }
}

export async function updateGymSessionSet(
  id: string,
  patch: { reps?: number; weightKg?: number }
): Promise<GymSessionSet> {
  const database = await getDatabase()
  const old = await getRecord<GymSessionSet>(
    database,
    STORE_GYM_SESSION_SETS,
    id
  )
  if (!old) throw new RangeError(`Gym set "${id}" does not exist`)
  await assertSessionEditable(database, old.sessionId)
  const record: GymSessionSet = {
    ...old,
    reps: patch.reps !== undefined ? assertReps(patch.reps) : old.reps,
    weightKg:
      patch.weightKg !== undefined
        ? assertWeightKg(patch.weightKg)
        : old.weightKg,
  }
  await putRecords(database, STORE_GYM_SESSION_SETS, [record])
  return record
}

export async function deleteGymSessionSet(id: string): Promise<void> {
  const database = await getDatabase()
  const old = await getRecord<GymSessionSet>(
    database,
    STORE_GYM_SESSION_SETS,
    id
  )
  if (!old) return
  await assertSessionEditable(database, old.sessionId)
  await deleteRecords(database, STORE_GYM_SESSION_SETS, [id])
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface GymExerciseHistoryEntry {
  session: GymSession
  sets: GymSessionSet[]
}

/** All sessions (newest first) that contain sets of the given exercise. */
export async function getGymExerciseHistory(
  exerciseId: string
): Promise<GymExerciseHistoryEntry[]> {
  const database = await getDatabase()
  const sets = await getAllFromIndex<GymSessionSet>(
    database,
    STORE_GYM_SESSION_SETS,
    'by_exercise',
    exerciseId
  )
  const bySession = new Map<string, GymSessionSet[]>()
  for (const set of sets) {
    const rows = bySession.get(set.sessionId)
    if (rows) rows.push(set)
    else bySession.set(set.sessionId, [set])
  }
  const entries: GymExerciseHistoryEntry[] = []
  for (const [sessionId, rows] of bySession) {
    const session = await getRecord<GymSession>(
      database,
      STORE_GYM_SESSIONS,
      sessionId
    )
    if (!session) continue
    rows.sort(
      (a, b) =>
        a.setNumber - b.setNumber || a.createdAt.localeCompare(b.createdAt)
    )
    entries.push({ session, sets: rows })
  }
  return entries.sort(
    (a, b) =>
      b.session.dateKey.localeCompare(a.session.dateKey) ||
      b.session.createdAt.localeCompare(a.session.createdAt)
  )
}

export interface GymExercisePerformance {
  dateKey: string
  sets: GymSessionSet[]
  topWeightKg: number
  topReps: number
  volumeKg: number
}

/** Last logged performance of an exercise, excluding one session id. */
export async function getLastGymExercisePerformance(
  exerciseId: string,
  excludeSessionId?: string
): Promise<GymExercisePerformance | undefined> {
  const entries = await getGymExerciseHistory(exerciseId)
  for (const { session, sets } of entries) {
    if (excludeSessionId && session.id === excludeSessionId) continue
    if (sets.length === 0) continue
    const top = sets.reduce((best, set) =>
      set.weightKg > best.weightKg ||
      (set.weightKg === best.weightKg && set.reps > best.reps)
        ? set
        : best
    )
    return {
      dateKey: session.dateKey,
      sets: [...sets],
      topWeightKg: top.weightKg,
      topReps: top.reps,
      volumeKg: sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
    }
  }
  return undefined
}
