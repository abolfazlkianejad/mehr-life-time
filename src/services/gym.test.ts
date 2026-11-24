import { beforeEach, describe, expect, it } from 'vitest'
import type { GymWeekday } from '@/lib/gym-weekdays'
import {
  DB_VERSION,
  destroyDatabase,
  getWorkoutLogs,
  initializeOfflineStorage,
} from '@/services/db'
import {
  completeGymSession,
  finishGymSessionTimer,
  deleteGymExercise,
  deleteGymPlan,
  deleteGymSession,
  deleteGymSessionSet,
  getAllGymExercises,
  getGymExerciseHistory,
  getGymExercises,
  getGymPlan,
  getGymPlans,
  getGymSessionSets,
  getGymSessions,
  getGymSessionsByDate,
  getLastGymExercisePerformance,
  gymElapsedSeconds,
  isGymTimerRunning,
  moveGymExercise,
  pauseGymSessionTimer,
  saveGymExercise,
  saveGymPlan,
  saveGymSessionSet,
  startGymSession,
  startGymSessionTimer,
  startPlannedGymSession,
  updateGymExerciseName,
  updateGymSessionSet,
} from '@/services/gym'
import { deleteDatabase } from '@/services/idb'

// 2026-01-15 is a Thursday (weekday 5), 2026-01-16 a Friday (6) and
// 2026-01-17 a Saturday (0).
const THURSDAY = '2026-01-15'
const FRIDAY = '2026-01-16'
const SATURDAY = '2026-01-17'

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage()
}

async function seedSession(
  dateKey: string,
  title: string,
  exercise: { id: string; name: string },
  sets: { setNumber: number; reps: number; weightKg: number }[]
): Promise<{ sessionId: string }> {
  const session = await startGymSession(dateKey, title)
  for (const set of sets) {
    await saveGymSessionSet({
      sessionId: session.id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      ...set,
    })
  }
  return { sessionId: session.id }
}

describe('gym plans', () => {
  beforeEach(freshDatabase)

  it('creates, reads and sorts weekly plans by weekday', async () => {
    await saveGymPlan(2, 'پا و سرشانه')
    await saveGymPlan(0, 'سینه و پشت بازو')
    await saveGymPlan(6, 'هوازی')

    const plans = await getGymPlans()
    expect(plans.map((plan) => plan.weekday)).toEqual([0, 2, 6])
    expect(plans.map((plan) => plan.title)).toEqual([
      'سینه و پشت بازو',
      'پا و سرشانه',
      'هوازی',
    ])
    expect(plans.every((plan) => typeof plan.updatedAt === 'string')).toBe(true)
  })

  it('trims titles and rejects empty or invalid input', async () => {
    const plan = await saveGymPlan(3, '  پرس سینه  ')
    expect(plan.title).toBe('پرس سینه')
    await expect(saveGymPlan(3, '   ')).rejects.toThrow(RangeError)
    await expect(saveGymPlan(9 as GymWeekday, 'پا')).rejects.toThrow(RangeError)
  })

  it('replaces the title when the weekday already has a plan', async () => {
    await saveGymPlan(4, 'اول')
    await saveGymPlan(4, 'دوم')

    const plans = await getGymPlans()
    expect(plans).toHaveLength(1)
    expect(plans[0]?.title).toBe('دوم')
  })

  it('deletes the plan and its exercises but keeps logged sessions', async () => {
    await saveGymPlan(0, 'سینه')
    const exercise = await saveGymExercise({ weekday: 0, name: 'پرس سینه' })
    await seedSession(SATURDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 10, weightKg: 60 },
    ])

    await deleteGymPlan(0)

    await expect(getGymPlan(0)).resolves.toBeUndefined()
    await expect(getGymExercises(0)).resolves.toEqual([])
    const sessions = await getGymSessions()
    expect(sessions).toHaveLength(1)
    expect(await getGymSessionSets(sessions[0]!.id)).toHaveLength(1)
  })
})

describe('gym exercises', () => {
  beforeEach(freshDatabase)

  it('numbers exercises in creation order per weekday', async () => {
    const squat = await saveGymExercise({ weekday: 5, name: 'اسکوات' })
    const lunge = await saveGymExercise({ weekday: 5, name: 'لانچ' })

    expect(squat.order).toBe(1)
    expect(lunge.order).toBe(2)
    const exercises = await getGymExercises(5)
    expect(exercises.map((entry) => entry.name)).toEqual(['اسکوات', 'لانچ'])
  })

  it('moves an exercise up and down inside its weekday plan', async () => {
    const first = await saveGymExercise({ weekday: 1, name: 'A' })
    const middle = await saveGymExercise({ weekday: 1, name: 'B' })
    const last = await saveGymExercise({ weekday: 1, name: 'C' })

    await moveGymExercise(middle.id, 'up')
    let names = (await getGymExercises(1)).map((entry) => entry.name)
    expect(names).toEqual(['B', 'A', 'C'])

    await moveGymExercise(middle.id, 'down')
    names = (await getGymExercises(1)).map((entry) => entry.name)
    expect(names).toEqual(['A', 'B', 'C'])

    // Moving the first entry up or the last entry down changes nothing.
    await moveGymExercise(first.id, 'up')
    await moveGymExercise(last.id, 'down')
    names = (await getGymExercises(1)).map((entry) => entry.name)
    expect(names).toEqual(['A', 'B', 'C'])
  })

  it('renames an exercise and validates the new name', async () => {
    const exercise = await saveGymExercise({ weekday: 2, name: 'پرس' })

    const renamed = await updateGymExerciseName(
      exercise.id,
      '  پرس بالا سینه  '
    )
    expect(renamed.name).toBe('پرس بالا سینه')
    await expect(updateGymExerciseName(exercise.id, '   ')).rejects.toThrow(
      RangeError
    )
    await expect(updateGymExerciseName('missing', 'پرس')).rejects.toThrow(
      RangeError
    )
  })

  it('deletes the plan row only; logged sets and history stay', async () => {
    const exercise = await saveGymExercise({ weekday: 6, name: 'ددلیفت' })
    const { sessionId } = await seedSession(FRIDAY, 'کشش', exercise, [
      { setNumber: 1, reps: 5, weightKg: 100 },
    ])

    await deleteGymExercise(exercise.id)

    expect((await getGymExercises(6)).map((entry) => entry.id)).not.toContain(
      exercise.id
    )
    expect(await getGymSessionSets(sessionId)).toHaveLength(1)

    const history = await getGymExerciseHistory(exercise.id)
    expect(history).toHaveLength(1)
    expect(history[0]?.sets[0]?.exerciseName).toBe('ددلیفت')
  })

  it('lists plan exercises across weekdays sorted by weekday then order', async () => {
    await saveGymExercise({ weekday: 6, name: 'A' })
    await saveGymExercise({ weekday: 0, name: 'B' })
    await saveGymExercise({ weekday: 0, name: 'C' })

    const all = await getAllGymExercises()
    expect(all.map((entry) => [entry.weekday, entry.name])).toEqual([
      [0, 'B'],
      [0, 'C'],
      [6, 'A'],
    ])
  })
})

describe('gym sessions', () => {
  beforeEach(freshDatabase)

  it('derives the weekday from the date and sorts sessions newest first', async () => {
    const thursday = await startGymSession(THURSDAY, 'سینه')
    const saturday = await startGymSession(SATURDAY, 'پا')

    expect(thursday.weekday).toBe(5)
    expect(saturday.weekday).toBe(0)
    expect(thursday.status).toBe('draft')

    const sessions = await getGymSessions()
    expect(sessions.map((session) => session.dateKey)).toEqual([
      SATURDAY,
      THURSDAY,
    ])
    await expect(getGymSessionsByDate(THURSDAY)).resolves.toHaveLength(1)
    await expect(getGymSessionsByDate('bad-date')).rejects.toThrow(RangeError)
    await expect(startGymSession('bad-date', 'سینه')).rejects.toThrow(
      RangeError
    )
    await expect(startGymSession(THURSDAY, '   ')).rejects.toThrow(RangeError)
  })

  it('logs independent sets with their own reps and weights', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const { sessionId } = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 12, weightKg: 60 },
      { setNumber: 2, reps: 10, weightKg: 65.5 },
      { setNumber: 3, reps: 8, weightKg: 70 },
    ])

    const sets = await getGymSessionSets(sessionId)
    expect(sets.map((set) => [set.setNumber, set.reps, set.weightKg])).toEqual([
      [1, 12, 60],
      [2, 10, 65.5],
      [3, 8, 70],
    ])
  })

  it('rejects duplicate set numbers, invalid values and unknown sessions', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const { sessionId } = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 10, weightKg: 60 },
    ])

    await expect(
      saveGymSessionSet({
        sessionId,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: 1,
        reps: 8,
        weightKg: 70,
      })
    ).rejects.toThrow(RangeError)
    await expect(
      saveGymSessionSet({
        sessionId,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: 2,
        reps: 0,
        weightKg: 60,
      })
    ).rejects.toThrow(RangeError)
    await expect(
      saveGymSessionSet({
        sessionId,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: 2,
        reps: 10,
        weightKg: -1,
      })
    ).rejects.toThrow(RangeError)
    await expect(
      saveGymSessionSet({
        sessionId: 'missing',
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: 1,
        reps: 10,
        weightKg: 60,
      })
    ).rejects.toThrow(RangeError)
  })

  it('edits and deletes sets of a draft session', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const { sessionId } = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 10, weightKg: 60 },
    ])
    const set = (await getGymSessionSets(sessionId))[0]!

    const updated = await updateGymSessionSet(set.id, {
      reps: 9,
      weightKg: 62.5,
    })
    expect(updated.reps).toBe(9)
    expect(updated.weightKg).toBe(62.5)

    await deleteGymSessionSet(set.id)
    expect(await getGymSessionSets(sessionId)).toHaveLength(0)
  })

  it('completes a session with sets and freezes it afterwards', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const { sessionId } = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 10, weightKg: 60 },
    ])

    const done = await completeGymSession(sessionId)
    expect(done.status).toBe('done')
    expect(typeof done.completedAt).toBe('string')

    // Completing again returns the same session without errors.
    await expect(completeGymSession(sessionId)).resolves.toMatchObject({
      id: sessionId,
      status: 'done',
    })

    // A completed session is immutable.
    await expect(
      saveGymSessionSet({
        sessionId,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: 2,
        reps: 8,
        weightKg: 65,
      })
    ).rejects.toThrow(RangeError)
    const set = (await getGymSessionSets(sessionId))[0]!
    await expect(updateGymSessionSet(set.id, { reps: 5 })).rejects.toThrow(
      RangeError
    )
    await expect(deleteGymSessionSet(set.id)).rejects.toThrow(RangeError)
    await expect(deleteGymSession(sessionId)).rejects.toThrow(RangeError)
  })

  it('refuses to complete an empty session but allows deleting it', async () => {
    const session = await startGymSession(THURSDAY, 'سینه')

    await expect(completeGymSession(session.id)).rejects.toThrow(RangeError)
    await deleteGymSession(session.id)
    expect(await getGymSessions()).toHaveLength(0)
  })

  it('deleting a draft session removes its sets too', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const { sessionId } = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 10, weightKg: 60 },
      { setNumber: 2, reps: 8, weightKg: 65 },
    ])

    await deleteGymSession(sessionId)

    expect(await getGymSessions()).toHaveLength(0)
    expect(await getGymSessionSets(sessionId)).toHaveLength(0)
  })
})

describe('gym session timer', () => {
  beforeEach(freshDatabase)

  const T0 = Date.parse('2026-01-15T09:00:00.000Z')

  it('records elapsed time across pause and resume without counting paused time', async () => {
    const session = await startGymSession(THURSDAY, 'سینه', 45, T0)
    const started = await startGymSessionTimer(session.id, T0)
    expect(isGymTimerRunning(started)).toBe(true)
    expect(gymElapsedSeconds(started, T0 + 90_000)).toBe(90)

    // A repeated start is a no-op, so a double click cannot add a second timer.
    const repeated = await startGymSessionTimer(session.id, T0 + 90_000)
    expect(repeated.timerStartedAt).toBe(started.timerStartedAt)
    expect(isGymTimerRunning(repeated)).toBe(true)

    const paused = await pauseGymSessionTimer(session.id, T0 + 120_000)
    expect(paused.elapsedSeconds).toBe(120)
    expect(paused.timerStartedAt).toBeUndefined()
    expect(gymElapsedSeconds(paused, T0 + 600_000)).toBe(120)

    const resumed = await startGymSessionTimer(session.id, T0 + 600_000)
    expect(isGymTimerRunning(resumed)).toBe(true)
    expect(gymElapsedSeconds(resumed, T0 + 630_000)).toBe(150)

    const finished = await finishGymSessionTimer(session.id, T0 + 630_000)
    expect(finished.status).toBe('done')
    expect(finished.actualSeconds).toBe(150)
    expect(finished.timerStartedAt).toBeUndefined()

    const stored = (await getGymSessions())[0]!
    expect(stored.actualSeconds).toBe(150)
    // Finishing twice never changes the saved duration.
    await expect(
      finishGymSessionTimer(session.id, T0 + 900_000)
    ).resolves.toMatchObject({ actualSeconds: 150, status: 'done' })
  })

  it('restores a running timer after a reopen and saves the duration once', async () => {
    const session = await startPlannedGymSession(THURSDAY, 'Timer plan', 45, T0)
    const storedSession = async () =>
      (await getGymSessions()).find((entry) => entry.id === session.id)!

    // The service reads IndexedDB on every call, so a fresh read models a
    // desktop close/reopen without touching any real history.
    let reopened = await storedSession()
    expect(isGymTimerRunning(reopened)).toBe(true)
    expect(gymElapsedSeconds(reopened, T0 + 30_000)).toBe(30)

    // Repeating the dashboard start must neither duplicate the session nor
    // restart the already running timer.
    const repeated = await startPlannedGymSession(
      THURSDAY,
      'Timer plan',
      45,
      T0 + 45_000
    )
    expect(repeated.id).toBe(session.id)
    expect(repeated.timerStartedAt).toBe(session.timerStartedAt)
    expect(await getGymSessions()).toHaveLength(1)

    const paused = await pauseGymSessionTimer(session.id, T0 + 60_000)
    expect(paused.elapsedSeconds).toBe(60)
    expect(isGymTimerRunning(paused)).toBe(false)
    reopened = await storedSession()
    expect(gymElapsedSeconds(reopened, T0 + 300_000)).toBe(60)

    const resumed = await startGymSessionTimer(session.id, T0 + 300_000)
    expect(isGymTimerRunning(resumed)).toBe(true)
    reopened = await storedSession()
    expect(isGymTimerRunning(reopened)).toBe(true)
    expect(gymElapsedSeconds(reopened, T0 + 330_000)).toBe(90)

    const finished = await finishGymSessionTimer(session.id, T0 + 330_000)
    expect(finished).toMatchObject({
      status: 'done',
      elapsedSeconds: 90,
      actualSeconds: 90,
    })
    expect(finished.timerStartedAt).toBeUndefined()
    expect((await storedSession()).actualSeconds).toBe(90)
    expect(await getGymSessions()).toHaveLength(1)

    const repeatedFinish = await finishGymSessionTimer(session.id, T0 + 900_000)
    expect(repeatedFinish.actualSeconds).toBe(90)
    expect((await storedSession()).actualSeconds).toBe(90)
  })

  it('allows only one running gym timer across all sessions', async () => {
    const first = await startGymSession(THURSDAY, 'اول', undefined, T0)
    const second = await startGymSession(THURSDAY, 'دوم', undefined, T0)
    await startGymSessionTimer(first.id, T0)
    const secondStarted = await startGymSessionTimer(second.id, T0 + 60_000)

    const sessions = await getGymSessions()
    const storedFirst = sessions.find((entry) => entry.id === first.id)!
    expect(storedFirst.elapsedSeconds).toBe(60)
    expect(storedFirst.timerStartedAt).toBeUndefined()
    expect(isGymTimerRunning(storedFirst)).toBe(false)
    expect(isGymTimerRunning(secondStarted)).toBe(true)
  })

  it('reuses a draft session for a planned workout instead of creating duplicates', async () => {
    const first = await startPlannedGymSession(THURSDAY, 'پا', 45, T0)
    const repeated = await startPlannedGymSession(
      THURSDAY,
      'پا',
      45,
      T0 + 60_000
    )

    expect(repeated.id).toBe(first.id)
    expect(repeated.plannedMinutes).toBe(45)
    expect(repeated.timerStartedAt).toBe(first.timerStartedAt)
    expect(await getGymSessions()).toHaveLength(1)
  })

  it('saves measured time in history when a session with sets is completed', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'اسکوات' })
    const session = await startGymSession(THURSDAY, 'پا', undefined, T0)
    await saveGymSessionSet({
      sessionId: session.id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setNumber: 1,
      reps: 10,
      weightKg: 60,
    })
    await startGymSessionTimer(session.id, T0)
    await pauseGymSessionTimer(session.id, T0 + 180_000)

    const done = await completeGymSession(session.id)
    expect(done.status).toBe('done')
    expect(done.actualSeconds).toBe(180)
    expect(await getGymSessionSets(session.id)).toHaveLength(1)
  })
})

describe('gym history', () => {
  beforeEach(freshDatabase)

  it('groups sets per session and keeps snapshots after a rename', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'پرس سینه' })
    const first = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 12, weightKg: 60 },
      { setNumber: 2, reps: 10, weightKg: 65 },
    ])
    await completeGymSession(first.sessionId)

    await updateGymExerciseName(exercise.id, 'پرس سینه بالا')
    const second = await seedSession(THURSDAY, 'سینه دوم', exercise, [
      { setNumber: 1, reps: 10, weightKg: 70 },
    ])
    await completeGymSession(second.sessionId)

    const history = await getGymExerciseHistory(exercise.id)
    expect(history).toHaveLength(2)
    // Newest first: same date, so the later session comes first.
    expect(history[0]?.session.id).toBe(second.sessionId)
    expect(history[0]?.sets).toHaveLength(1)
    expect(history[1]?.session.id).toBe(first.sessionId)
    expect(
      history[1]?.sets.every((set) => set.exerciseName === 'پرس سینه')
    ).toBe(true)
  })

  it('keeps last performance available after the exercise leaves the plan', async () => {
    const exercise = await saveGymExercise({ weekday: 5, name: 'ددلیفت' })
    const first = await seedSession(THURSDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 5, weightKg: 100 },
    ])
    await completeGymSession(first.sessionId)
    await deleteGymExercise(exercise.id)

    const last = await getLastGymExercisePerformance(exercise.id)
    expect(last).toMatchObject({
      dateKey: THURSDAY,
      topWeightKg: 100,
      topReps: 5,
      volumeKg: 500,
    })

    // A later session supersedes the older performance.
    const second = await seedSession(SATURDAY, 'سینه', exercise, [
      { setNumber: 1, reps: 3, weightKg: 110 },
    ])
    await completeGymSession(second.sessionId)

    const latest = await getLastGymExercisePerformance(exercise.id)
    expect(latest).toMatchObject({
      dateKey: SATURDAY,
      topWeightKg: 110,
      topReps: 3,
    })

    // Excluding the active session surfaces the previous performance.
    const excluded = await getLastGymExercisePerformance(
      exercise.id,
      second.sessionId
    )
    expect(excluded).toMatchObject({
      dateKey: THURSDAY,
      topWeightKg: 100,
      topReps: 5,
    })

    await expect(getLastGymExercisePerformance('missing')).resolves.toBe(
      undefined
    )
  })
})

describe('gym schema upgrade', () => {
  beforeEach(freshDatabase)

  it('upgrades a v11 database to v12 without losing workout logs', async () => {
    await destroyDatabase()

    // Simulate the v11 schema with the pre-redesign workoutLogs store.
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mehr-life-os', DB_VERSION - 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('workoutLogs', {
          keyPath: 'id',
        })
        store.createIndex('by_date_key', 'dateKey')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const record = {
      id: 'legacy-set',
      dateKey: THURSDAY,
      exercise: 'پرس سینه',
      set: 1,
      weightKg: 60,
      reps: 12,
      rir: 1,
      createdAt: '2026-01-15T10:00:00.000Z',
    }
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction('workoutLogs', 'readwrite')
      tx.objectStore('workoutLogs').put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    legacy.close()

    await initializeOfflineStorage()

    await expect(getWorkoutLogs(THURSDAY)).resolves.toContainEqual(record)
    await expect(getGymPlans()).resolves.toEqual([])
    await expect(getGymSessions()).resolves.toEqual([])
    await expect(getAllGymExercises()).resolves.toEqual([])

    await deleteDatabase('mehr-life-os')
  })
})
