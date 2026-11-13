import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  destroyDatabase,
  getDashboardDay,
  getPreviousDashboardNote,
  getTimelineBlock,
  initializeOfflineStorage,
  runStartupRollover,
  saveDashboardDay,
  saveDashboardNote,
  saveWorkTask,
  type DashboardDayRecord,
} from '@/services/db'

const REFERENCE = new Date(2026, 0, 15, 9, 0, 0)

function dayRecord(dateKey: string, note: string): DashboardDayRecord {
  return { dateKey, wakeTime: '', breakfast: '', bagItems: [], commuteTime: '', note, updatedAt: '' }
}

describe('dashboard quick note persistence', () => {
  beforeEach(async () => {
    await destroyDatabase()
    await initializeOfflineStorage(REFERENCE)
  })

  it('saves only the note and keeps the routine fields of the same day', async () => {
    await saveDashboardDay({
      ...dayRecord('2026-01-15', ''),
      wakeTime: '06:30',
      breakfast: 'Oats',
      bagItems: [{ id: 'laptop', label: 'Laptop', checked: true }],
      commuteTime: '07:45',
      readingMinutes: 20,
    })

    await saveDashboardNote('2026-01-15', 'Call the bank')

    await expect(getDashboardDay('2026-01-15')).resolves.toMatchObject({
      dateKey: '2026-01-15',
      note: 'Call the bank',
      wakeTime: '06:30',
      breakfast: 'Oats',
      bagItems: [{ id: 'laptop', label: 'Laptop', checked: true }],
      commuteTime: '07:45',
      readingMinutes: 20,
    })
  })

  it('creates the day record when the first thing saved is a note', async () => {
    const saved = await saveDashboardNote('2026-01-20', 'First note')

    expect(saved.updatedAt).not.toBe('')
    await expect(getDashboardDay('2026-01-20')).resolves.toMatchObject({
      dateKey: '2026-01-20',
      note: 'First note',
      wakeTime: '',
      bagItems: [],
    })
  })

  it('keeps the last keystroke when several saves are in flight at once', async () => {
    await Promise.all([
      saveDashboardNote('2026-01-15', 'a'),
      saveDashboardNote('2026-01-15', 'ab'),
      saveDashboardNote('2026-01-15', 'abc'),
    ])

    await expect(getDashboardDay('2026-01-15')).resolves.toMatchObject({ note: 'abc' })
  })

  it('finds the latest non-empty note from an earlier day', async () => {
    await saveDashboardNote('2026-01-10', 'Oldest')
    await saveDashboardNote('2026-01-12', 'Latest earlier note')
    await saveDashboardNote('2026-01-13', '   ')
    const { note: _note, ...legacyWithoutNote } = dayRecord('2026-01-14', '')
    await saveDashboardDay(legacyWithoutNote as DashboardDayRecord)
    await saveDashboardNote('2026-01-15', 'Today')
    await saveDashboardNote('2026-01-18', 'Future')

    await expect(getPreviousDashboardNote('2026-01-15')).resolves.toEqual({
      dateKey: '2026-01-12',
      note: 'Latest earlier note',
    })
    await expect(getPreviousDashboardNote('2026-01-10')).resolves.toBeUndefined()
  })
})

describe('startup rollover', () => {
  beforeEach(async () => {
    await destroyDatabase()
    await initializeOfflineStorage(REFERENCE)
  })

  it('moves an overdue task once per session and shares the result with every reader', async () => {
    const task = await saveWorkTask({
      title: 'Morning report',
      startTime: new Date(2026, 0, 16, 9, 0, 0),
      durationMinutes: 60,
      isCompanyWork: true,
    })

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 0, 16, 11, 0, 0))
      const first = runStartupRollover()
      expect(runStartupRollover()).toBe(first)

      const moved = await first
      expect(moved.map((record) => record.id)).toEqual([task.id])
      const afterMove = await getTimelineBlock(task.id)
      expect(afterMove).toMatchObject({ status: 'rolled_over', rolledOverFrom: '2026-01-16' })
      expect(Date.parse(afterMove!.startTime)).toBeGreaterThan(new Date(2026, 0, 16, 11, 0, 0).getTime())

      vi.setSystemTime(new Date(2026, 0, 16, 23, 0, 0))
      await expect(runStartupRollover()).resolves.toBe(moved)
      await expect(getTimelineBlock(task.id)).resolves.toEqual(afterMove)
    } finally {
      vi.useRealTimers()
    }
  })
})
