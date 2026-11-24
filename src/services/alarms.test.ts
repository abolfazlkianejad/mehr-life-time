import { beforeEach, describe, expect, it } from 'vitest'
import {
  cancelAlarm,
  cancelTaskAlarm,
  claimAlarm,
  dismissAlarm,
  getAlarms,
  getUpcomingAlarms,
  isAlarmDue,
  isAlarmMissed,
  saveAlarm,
  snoozeAlarm,
  sweepMissedAlarms,
} from '@/services/alarms'
import { destroyDatabase, initializeOfflineStorage } from '@/services/db'

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime()
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage(new Date(NOW))
}

describe('alarm scheduling', () => {
  beforeEach(freshDatabase)

  it('fires a due reminder exactly once (duplicate guard)', async () => {
    const alarm = await saveAlarm({
      title: 'Stand up',
      at: iso(-60_000),
      source: 'manual',
    })
    expect(isAlarmDue(alarm, NOW)).toBe(true)

    const first = await claimAlarm(alarm.id, NOW)
    expect(first?.status).toBe('fired')
    expect(first?.firedOccurrence).toBe(alarm.at)
    expect(first?.lastFiredAt).toBe(new Date(NOW).toISOString())

    // A second tab (or a second poll) sees the claimed occurrence and gets null.
    const second = await claimAlarm(alarm.id, NOW)
    expect(second).toBeNull()
    expect((await getAlarms())[0]?.firedOccurrence).toBe(alarm.at)
  })

  it('does not fire before the scheduled instant', async () => {
    const alarm = await saveAlarm({ title: 'Later', at: iso(60_000) })
    expect(isAlarmDue(alarm, NOW)).toBe(false)
    expect(await claimAlarm(alarm.id, NOW)).toBeNull()
    expect((await getAlarms())[0]?.status).toBe('scheduled')
  })

  it('keeps a one-hour grace window and then reports the reminder as missed', async () => {
    const withinGrace = await saveAlarm({
      title: 'Grace',
      at: iso(-30 * 60_000),
    })
    expect(isAlarmDue(withinGrace, NOW)).toBe(true)

    const old = await saveAlarm({ title: 'Old', at: iso(-2 * 60 * 60_000) })
    expect(isAlarmDue(old, NOW)).toBe(false)
    expect(isAlarmMissed(old, NOW)).toBe(true)

    const swept = await sweepMissedAlarms(NOW)
    expect(swept).toBe(1)
    const rows = await getAlarms()
    expect(rows.find((row) => row.id === old.id)?.status).toBe('missed')
    expect(rows.find((row) => row.id === withinGrace.id)?.status).toBe(
      'scheduled'
    )
    expect(await claimAlarm(old.id, NOW)).toBeNull()
  })

  it('snoozes to a new future occurrence and fires it once', async () => {
    const alarm = await saveAlarm({ title: 'Snooze me', at: iso(-60_000) })
    await claimAlarm(alarm.id, NOW)
    const snoozed = await snoozeAlarm(alarm.id, 10, NOW)
    expect(snoozed.status).toBe('scheduled')
    expect(snoozed.at).toBe(iso(10 * 60_000))
    expect(snoozed.snoozeCount).toBe(1)
    expect(snoozed.firedOccurrence).toBeUndefined()

    expect(await claimAlarm(alarm.id, NOW)).toBeNull()
    const fired = await claimAlarm(alarm.id, NOW + 11 * 60_000)
    expect(fired?.status).toBe('fired')
    expect(fired?.firedOccurrence).toBe(snoozed.at)
  })

  it('dismisses and cancels without deleting the history row', async () => {
    const dismissed = await saveAlarm({ title: 'Dismiss', at: iso(-60_000) })
    await dismissAlarm(dismissed.id)
    expect(
      (await getAlarms()).find((row) => row.id === dismissed.id)?.status
    ).toBe('dismissed')

    const cancelled = await saveAlarm({ title: 'Cancel', at: iso(120_000) })
    await cancelAlarm(cancelled.id)
    expect(
      (await getAlarms()).find((row) => row.id === cancelled.id)?.status
    ).toBe('cancelled')
    expect(await getUpcomingAlarms(NOW)).toHaveLength(0)
  })

  it('replaces the reminder of the same task instead of duplicating it', async () => {
    const first = await saveAlarm({
      title: 'Task A',
      at: iso(60_000),
      taskId: 'task-1',
    })
    const second = await saveAlarm({
      title: 'Task A',
      at: iso(120_000),
      taskId: 'task-1',
    })
    expect(second.id).toBe(first.id)
    const rows = await getAlarms()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.at).toBe(iso(120_000))

    await cancelTaskAlarm('task-1')
    expect(await getAlarms()).toHaveLength(0)
  })

  it('reads the saved reminders back from IndexedDB (reload-safe)', async () => {
    const saved = await saveAlarm({ title: 'Persisted', at: iso(5 * 60_000) })
    // Re-running the storage initializer is what a browser reload does; the
    // reminder must still be there instead of living only in React state.
    await initializeOfflineStorage(new Date(NOW))
    const rows = await getAlarms()
    expect(rows.find((row) => row.id === saved.id)).toMatchObject({
      title: 'Persisted',
      status: 'scheduled',
      at: saved.at,
    })
  })

  it('rejects an invalid alarm time instead of scheduling it at the wrong moment', async () => {
    await expect(saveAlarm({ title: 'Bad', at: 'not-a-date' })).rejects.toThrow(
      /alarm time is invalid/
    )
    await expect(saveAlarm({ title: '   ', at: iso(0) })).rejects.toThrow(
      /title is required/
    )
  })
})
