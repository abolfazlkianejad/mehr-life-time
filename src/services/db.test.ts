import { addDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toDateKey } from '@/lib/date-key'
import {
  deleteWorkSession,
  completeWorkTask,
  deleteWorkTask,
  deleteFinanceEntry,
  deleteSocialDraft,
  destroyDatabase,
  finishStudyTimer,
  getDailyEnergyScore,
  getFinanceEntries,
  getFinanceSettings,
  getLegacyTasks,
  getNewsItems,
  getOpportunityRecords,
  getSocialDrafts,
  getStudyLogsByRange,
  getStudyTimer,
  getEnergyTrend,
  getStoreCounts,
  getTimelineBlocksForDay,
  getTimelineBlock,
  getTimelineDay,
  getWorkHoursByDay,
  getWorkSessionsByDate,
  getWorkTotals,
  hasSeededData,
  initializeOfflineStorage,
  markConflicts,
  pauseStudyTimer,
  pauseWorkTaskTimer,
  rolloverWorkTask,
  saveStudyTimerMeta,
  saveWorkTask,
  startStudyTimer,
  startWorkTaskTimer,
  stopWorkTaskTimer,
  saveEnergyLog,
  saveFinanceEntry,
  saveFinanceSettings,
  saveSocialDraft,
  saveNewsItem,
  saveStudyLog,
  saveOpportunityRecord,
  saveTimelineBlock,
  saveWorkSession,
  seedDatabase,
  summarizeWorkSessions,
  updateTimelineBlock,
  updateWorkSession,
  updateWorkTask,
  updateOpportunityRecord,
  deleteOpportunityRecord,
} from '@/services/db'
import { deleteDatabase } from '@/services/idb'
import { buildSeedBundle } from '@/services/seed'

const REFERENCE = new Date(2026, 0, 15, 9, 0, 0)
const TODAY = toDateKey(REFERENCE)

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage(REFERENCE)
  await seedDatabase(buildSeedBundle(REFERENCE), {
    onlyIfEmpty: true,
    reference: REFERENCE,
  })
}

describe('offline storage engine', () => {
  beforeEach(async () => {
    await freshDatabase()
  })

  it('starts with an empty database instead of presenting generated data as user data', async () => {
    await destroyDatabase()
    await initializeOfflineStorage(REFERENCE)
    const counts = await getStoreCounts()

    expect(counts.timelineBlocks).toBe(0)
    expect(counts.workSessions).toBe(0)
    expect(counts.energyLogs).toBe(0)
    await expect(hasSeededData()).resolves.toBe(false)
  })

  it('does not duplicate seed rows on a second initialization', async () => {
    const before = await getStoreCounts()

    const result = await seedDatabase(buildSeedBundle(REFERENCE), {
      onlyIfEmpty: true,
      reference: REFERENCE,
    })

    expect(result.seeded).toBe(false)
    await expect(getStoreCounts()).resolves.toEqual(before)
  })

  it('copies old prototype tasks without removing or assigning guessed schedule fields', async () => {
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mehr-life-time', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('tasks', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const oldTask = {
      id: 'legacy-1',
      title: 'Old task',
      createdAt: 1234,
      completedAt: 2345,
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = oldDb.transaction('tasks', 'readwrite')
      transaction.objectStore('tasks').put(oldTask)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    oldDb.close()
    await destroyDatabase()
    await initializeOfflineStorage(REFERENCE)

    await expect(getLegacyTasks()).resolves.toContainEqual(oldTask)
    const source = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mehr-life-time')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await expect(
      new Promise<unknown>((resolve, reject) => {
        const request = source
          .transaction('tasks', 'readonly')
          .objectStore('tasks')
          .get('legacy-1')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    ).resolves.toEqual(oldTask)
    source.close()
    await deleteDatabase('mehr-life-time')
  })

  it('reads timeline blocks of a given date sorted by start time', async () => {
    const blocks = await getTimelineBlocksForDay(REFERENCE)

    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((block) => block.dateKey === TODAY)).toBe(true)

    const starts = blocks.map((block) => block.startTime)
    expect(starts).toEqual([...starts].sort())
  })

  it('returns an empty list for a day without blocks', async () => {
    await expect(
      getTimelineBlocksForDay(addDays(REFERENCE, 40))
    ).resolves.toEqual([])
  })

  it('makes study achievements available across a selected date range', async () => {
    const log = await saveStudyLog({
      category: 'ml',
      minutes: 30,
      note: 'Reviewed attention mechanisms',
    })
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    await expect(
      getStudyLogsByRange(monthStart, monthEnd)
    ).resolves.toContainEqual(log)
    await expect(
      getStudyLogsByRange(addDays(REFERENCE, 40), addDays(REFERENCE, 45))
    ).resolves.toEqual([])
  })

  it('stores, patches and summarizes a timeline block', async () => {
    const created = await saveTimelineBlock({
      title: 'بررسی کد',
      category: 'work',
      startTime: new Date(2026, 0, 15, 23, 0),
      endTime: new Date(2026, 0, 15, 23, 45),
      energyLevelRequired: 3,
    })

    expect(created.durationMinutes).toBe(45)
    expect(created.status).toBe('planned')
    expect(created.dateKey).toBe(TODAY)

    const updated = await updateTimelineBlock(created.id, {
      status: 'completed',
      isConflictFree: false,
    })
    expect(updated.status).toBe('completed')
    expect(updated.isConflictFree).toBe(false)
    expect(updated.title).toBe('بررسی کد')
    expect(updated.createdAt).toBe(created.createdAt)

    const { blocks, summary } = await getTimelineDay(REFERENCE)
    expect(blocks.some((block) => block.id === created.id)).toBe(true)
    expect(summary.totalBlocks).toBe(blocks.length)
    expect(summary.completedMinutes).toBeGreaterThan(0)
  })

  it('flags overlapping blocks as conflicting', () => {
    const base = {
      category: 'work',
      status: 'planned',
      energyLevelRequired: 3,
      isConflictFree: true,
      createdAt: '2026-01-15T06:00:00.000Z',
      updatedAt: '2026-01-15T06:00:00.000Z',
      dateKey: TODAY,
    } as const

    const marked = markConflicts([
      {
        ...base,
        id: 'a',
        title: 'A',
        startTime: '2026-01-15T07:00:00.000Z',
        endTime: '2026-01-15T08:00:00.000Z',
        durationMinutes: 60,
      },
      {
        ...base,
        id: 'b',
        title: 'B',
        startTime: '2026-01-15T07:30:00.000Z',
        endTime: '2026-01-15T08:30:00.000Z',
        durationMinutes: 60,
      },
      {
        ...base,
        id: 'c',
        title: 'C',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        durationMinutes: 60,
      },
    ])

    expect(marked.map((block) => block.isConflictFree)).toEqual([
      false,
      false,
      true,
    ])
  })

  it('filters work sessions by all / work_only / freelance_only', async () => {
    const all = await getWorkSessionsByDate(REFERENCE, 'all')
    const company = await getWorkSessionsByDate(REFERENCE, 'work_only')
    const freelance = await getWorkSessionsByDate(REFERENCE, 'freelance_only')

    expect(all.length).toBe(company.length + freelance.length)
    expect(company.every((session) => session.isCompanyWork)).toBe(true)
    expect(freelance.every((session) => !session.isCompanyWork)).toBe(true)
    expect(company.every((session) => session.kind === 'company')).toBe(true)
    expect(freelance.every((session) => session.kind === 'freelance')).toBe(
      true
    )
  })

  it('aggregates work hours for a day and for a range', async () => {
    const totals = await getWorkTotals(REFERENCE, REFERENCE)
    expect(totals.totalHours).toBeCloseTo(
      totals.companyHours + totals.freelanceHours,
      5
    )
    expect(totals.clientNames.length).toBeGreaterThan(0)

    const range = await getWorkHoursByDay(
      addDays(REFERENCE, -2),
      REFERENCE,
      'all'
    )
    expect(range).toHaveLength(3)
    expect(range[range.length - 1]?.dateKey).toBe(TODAY)
    expect(range[range.length - 1]?.hours).toBeCloseTo(totals.totalHours, 5)
  })

  it('applies the work/freelance filter on range queries too', async () => {
    const from = addDays(REFERENCE, -2)
    const all = await getWorkTotals(from, REFERENCE, 'all')
    const company = await getWorkTotals(from, REFERENCE, 'work_only')
    const freelance = await getWorkTotals(from, REFERENCE, 'freelance_only')

    expect(all.totalHours).toBeCloseTo(
      company.totalHours + freelance.totalHours,
      5
    )
    expect(company.freelanceHours).toBe(0)
    expect(freelance.companyHours).toBe(0)
    expect(company.totalHours).toBeGreaterThan(0)
    expect(freelance.totalHours).toBeGreaterThan(0)
  })

  it('keeps writes local-first when updating and deleting sessions', async () => {
    const created = await saveWorkSession({
      clientName: 'کلاینت تست',
      taskType: 'bugfix',
      durationHours: 1.25,
      date: REFERENCE,
      isCompanyWork: false,
    })

    expect(created.kind).toBe('freelance')

    const updated = await updateWorkSession(created.id, {
      isCompanyWork: true,
      durationHours: 2,
    })
    expect(updated.isCompanyWork).toBe(true)
    expect(updated.kind).toBe('company')
    expect(updated.durationHours).toBe(2)
    expect(updated.dateKey).toBe(TODAY)

    const freelanceOnly = await getWorkSessionsByDate(
      REFERENCE,
      'freelance_only'
    )
    expect(freelanceOnly.some((session) => session.id === created.id)).toBe(
      false
    )

    await deleteWorkSession(created.id)
    const remaining = await getWorkSessionsByDate(REFERENCE, 'all')
    expect(remaining.some((session) => session.id === created.id)).toBe(false)
  })

  it('computes daily energy score and a trend', async () => {
    const score = await getDailyEnergyScore(REFERENCE)
    expect(score).not.toBeNull()
    expect(score as number).toBeGreaterThanOrEqual(1)
    expect(score as number).toBeLessThanOrEqual(5)

    await saveEnergyLog({
      timestamp: new Date(2026, 0, 15, 23, 30),
      score: 1,
      note: 'پایان روز',
    })
    const afterLog = await getDailyEnergyScore(REFERENCE)
    expect(afterLog).not.toBeNull()
    expect(afterLog as number).toBeLessThan(score as number)

    const trend = await getEnergyTrend(addDays(REFERENCE, -2), REFERENCE)
    expect(trend.map((point) => point.dateKey)).toEqual([
      toDateKey(addDays(REFERENCE, -2)),
      toDateKey(addDays(REFERENCE, -1)),
      TODAY,
    ])
    expect(trend.every((point) => point.logCount > 0)).toBe(true)
  })

  it('creates, edits, filters, and deletes finance records and persists the savings goal', async () => {
    const created = await saveFinanceEntry({
      type: 'income',
      amount: 1250000,
      date: '2026-01-15',
      title: 'Monthly salary',
      category: 'salary',
    })
    await saveFinanceEntry({
      type: 'expense',
      amount: 250000,
      date: '2026-01-16',
      title: 'Groceries',
      category: 'food',
    })
    const updated = await saveFinanceEntry({
      id: created.id,
      type: 'income',
      amount: 1300000,
      date: '2026-01-15',
      title: 'Salary',
      category: 'salary',
    })
    expect(updated.createdAt).toBe(created.createdAt)
    expect(await getFinanceEntries('2026-01')).toHaveLength(2)
    expect(
      (await getFinanceEntries('2026-01', 'food')).map((entry) => entry.title)
    ).toEqual(['Groceries'])
    expect(await saveFinanceSettings(6000)).toEqual({
      id: 'default',
      savingsGoalBasisPoints: 6000,
    })
    expect(await getFinanceSettings()).toEqual({
      id: 'default',
      savingsGoalBasisPoints: 6000,
    })
    await deleteFinanceEntry(created.id)
    expect(await getFinanceEntries('2026-01')).toHaveLength(1)
  })

  it('saves, reads, updates, and deletes local social drafts', async () => {
    const draft = await saveSocialDraft({
      platform: 'linkedin',
      achievementId: 'block-1',
      achievementTitle: 'Completed an ML study block',
      text: 'First draft',
    })
    expect((await getSocialDrafts())[0]).toMatchObject({
      id: draft.id,
      text: 'First draft',
    })
    const updated = await saveSocialDraft({ ...draft, text: 'Edited draft' })
    expect(updated.createdAt).toBe(draft.createdAt)
    expect((await getSocialDrafts())[0]?.text).toBe('Edited draft')
    await deleteSocialDraft(draft.id)
    expect(await getSocialDrafts()).toEqual([])
  })

  it('stores local news source links and publication dates without accepting script URLs', async () => {
    const item = await saveNewsItem({
      category: 'technology',
      title: 'Browser storage update',
      summary: 'Local test record',
      source: 'Example newsroom',
      url: 'https://example.test/story',
      publishedAt: '2026-11-06',
    })

    expect(await getNewsItems()).toContainEqual(item)
    await expect(
      saveNewsItem({
        category: 'technology',
        title: 'Invalid URL test',
        summary: '',
        source: '',
        url: 'javascript:alert(1)',
      })
    ).rejects.toThrow(/http or https/i)
  })

  it('stores manually entered opportunities, prevents duplicate URLs, and bookmarks locally', async () => {
    const item = await saveOpportunityRecord({
      kind: 'freelance',
      platform: 'پونیشا',
      title: 'فورهیر: بهبود صفحهٔ محصول',
      url: 'https://example.com/projects/123',
      skills: ['WordPress', 'WooCommerce'],
      budgetToman: 2500000,
    })
    await expect(getOpportunityRecords('freelance')).resolves.toMatchObject([
      { id: item.id, title: item.title, bookmarked: false },
    ])
    await expect(
      saveOpportunityRecord({
        kind: 'freelance',
        platform: 'پونیشا',
        title: 'Duplicate',
        url: 'https://example.com/projects/123',
        skills: [],
      })
    ).rejects.toThrow()
    await updateOpportunityRecord(item.id, { bookmarked: true })
    await expect(getOpportunityRecords()).resolves.toMatchObject([
      { bookmarked: true },
    ])
    await deleteOpportunityRecord(item.id)
    await expect(getOpportunityRecords()).resolves.toEqual([])
  })

  it('summarizes totals without mutating the input list', async () => {
    const sessions = await getWorkSessionsByDate(REFERENCE, 'all')
    const snapshot = JSON.stringify(sessions)

    summarizeWorkSessions(sessions)

    expect(JSON.stringify(sessions)).toBe(snapshot)
  })

  it('persists finance entries, edits them, filters by category, and stores the savings target', async () => {
    const income = await saveFinanceEntry({
      type: 'income',
      amount: 12500000,
      date: '2026-01-15',
      title: 'Monthly salary',
      category: 'salary',
    })
    await saveFinanceEntry({
      type: 'expense',
      amount: 850000,
      date: '2026-01-16',
      title: 'Groceries',
      category: 'food',
    })
    const updated = await saveFinanceEntry({
      id: income.id,
      type: 'income',
      amount: 13000000,
      date: '2026-01-15',
      title: 'Salary',
      category: 'salary',
    })
    expect(updated.createdAt).toBe(income.createdAt)
    expect(await getFinanceEntries('2026-01')).toHaveLength(2)
    expect(
      (await getFinanceEntries('2026-01', 'food')).map((row) => row.title)
    ).toEqual(['Groceries'])
    await saveFinanceSettings(6000)
    expect(await getFinanceSettings()).toEqual({
      id: 'default',
      savingsGoalBasisPoints: 6000,
    })
    await deleteFinanceEntry(income.id)
    expect(await getFinanceEntries('2026-01')).toHaveLength(1)
  })

  it('round-trips social drafts through local storage CRUD', async () => {
    const draft = await saveSocialDraft({
      platform: 'linkedin',
      achievementId: 'block:1',
      achievementTitle: 'Completed a study block',
      text: 'Draft one',
    })
    expect((await getSocialDrafts())[0]?.text).toBe('Draft one')
    const edited = await saveSocialDraft({ ...draft, text: 'Edited locally' })
    expect(edited.createdAt).toBe(draft.createdAt)
    expect((await getSocialDrafts())[0]?.text).toBe('Edited locally')
    await deleteSocialDraft(draft.id)
    expect(await getSocialDrafts()).toEqual([])
  })

  it('protects lunch and prevents overlapping scheduled work tasks', async () => {
    await expect(
      saveWorkTask({
        title: 'Lunch conflict',
        startTime: new Date(2026, 0, 15, 13, 0),
        durationMinutes: 30,
        isCompanyWork: true,
      })
    ).rejects.toThrow(/lunch/i)
    const task = await saveWorkTask({
      title: 'Late task',
      startTime: new Date(2026, 0, 15, 22, 45),
      durationMinutes: 45,
      isCompanyWork: true,
    })
    await expect(
      saveWorkTask({
        title: 'Overlap',
        startTime: new Date(2026, 0, 15, 23, 0),
        durationMinutes: 30,
        isCompanyWork: true,
      })
    ).rejects.toThrow(/overlaps/i)
    expect(task.status).toBe('planned')
  })

  it('persists timer pauses, resumes, completion, and task rollover', async () => {
    const task = await saveWorkTask({
      title: 'Tracked task',
      startTime: new Date(2026, 0, 15, 22, 45),
      durationMinutes: 45,
      isCompanyWork: false,
    })
    const started = await startWorkTaskTimer(task.id)
    expect(started.timerStartedAt).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const paused = await pauseWorkTaskTimer(task.id)
    expect(paused.status).toBe('paused')
    expect(paused.timerStartedAt).toBeUndefined()
    expect(paused.elapsedSeconds).toBeGreaterThanOrEqual(1)
    const linkedInterval = (
      await getWorkSessionsByDate(new Date(), 'all')
    ).find((session) => session.timelineBlockId === task.id)
    expect(linkedInterval?.durationHours).toBeGreaterThan(0)
    expect(linkedInterval?.clientName).toBe(task.title)
    const rolled = await rolloverWorkTask(task.id, '2026-01-16')
    expect(rolled.dateKey).toBe('2026-01-16')
    expect(rolled.rolledOverFrom).toBe('2026-01-15')
    expect(rolled.elapsedSeconds).toBe(paused.elapsedSeconds)
    await startWorkTaskTimer(task.id)
    const stopped = await stopWorkTaskTimer(task.id)
    expect(stopped.status).toBe('planned')
    expect(stopped.elapsedSeconds).toBe(rolled.elapsedSeconds)
    await completeWorkTask(task.id)
    await expect(getTimelineBlock(task.id)).resolves.toMatchObject({
      status: 'completed',
      timerStartedAt: undefined,
    })
  })
})

describe('persistent study timer and editable work tasks', () => {
  beforeEach(async () => {
    await freshDatabase()
  })

  it('keeps the study timer and note across a reload, then saves a study log', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 0, 16, 9, 0, 0))
      const started = await startStudyTimer('exam')
      expect(started.startedAt).toBeTruthy()
      await saveStudyTimerMeta({ note: 'Timed practice questions' })

      vi.setSystemTime(new Date(2026, 0, 16, 9, 3, 0))
      const paused = await pauseStudyTimer()
      expect(paused?.startedAt).toBeUndefined()
      expect(paused?.accumulatedSeconds).toBe(180)

      await expect(getStudyTimer()).resolves.toMatchObject({
        category: 'exam',
        note: 'Timed practice questions',
        accumulatedSeconds: 180,
      })
    } finally {
      vi.useRealTimers()
    }

    const log = await finishStudyTimer({
      category: 'exam',
      note: 'Timed practice questions',
    })
    expect(log?.minutes).toBe(3)
    expect(log?.note).toBe('Timed practice questions')
    await expect(getStudyTimer()).resolves.toBeUndefined()
  })

  it('edits task priority and title without losing elapsed time, then deletes it', async () => {
    const task = await saveWorkTask({
      title: 'Ship header',
      startTime: new Date(2026, 0, 16, 9, 0),
      durationMinutes: 60,
      isCompanyWork: true,
      priority: 'high',
    })
    expect(task.priority).toBe('high')

    const updated = await updateWorkTask(task.id, {
      title: 'Ship header v2',
      priority: 'urgent',
    })
    expect(updated.title).toBe('Ship header v2')
    expect(updated.priority).toBe('urgent')
    expect(updated.elapsedSeconds).toBe(task.elapsedSeconds ?? 0)

    await deleteWorkTask(task.id)
    await expect(getTimelineBlock(task.id)).resolves.toBeUndefined()
  })

  it('refuses to move an editable task into the protected lunch hour', async () => {
    const task = await saveWorkTask({
      title: 'Morning block',
      startTime: new Date(2026, 0, 16, 9, 0),
      durationMinutes: 60,
      isCompanyWork: false,
    })
    await expect(
      updateWorkTask(task.id, { startTime: new Date(2026, 0, 16, 12, 30) })
    ).rejects.toThrow(/lunch/i)
  })
})
