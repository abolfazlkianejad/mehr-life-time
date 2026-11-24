/**
 * Desktop alarms / task reminders.
 *
 * The reminder itself is an absolute ISO instant, so a timezone or DST change
 * cannot shift it. `firedOccurrence` stores the exact `at` value that already
 * fired, which is the duplicate guard shared by every open tab and by the local
 * companion service.
 */
import { createId } from '@/lib/id'
import { getDatabase } from '@/services/db'
import {
  awaitTransaction,
  deleteRecords,
  getAllRecords,
  promisifyRequest,
  putRecords,
} from '@/services/idb'
import { STORE_ALARMS } from '@/services/stores'

export const ALARM_STATUSES = [
  'scheduled',
  'fired',
  'dismissed',
  'cancelled',
  'missed',
] as const
export type AlarmStatus = (typeof ALARM_STATUSES)[number]

export type AlarmSource = 'task' | 'manual'

export interface AlarmRecord {
  id: string
  title: string
  /** Absolute ISO instant of the next occurrence. */
  at: string
  taskId?: string
  source: AlarmSource
  status: AlarmStatus
  snoozeCount: number
  /** The `at` value that already fired; prevents duplicate firing. */
  firedOccurrence?: string
  lastFiredAt?: string
  createdAt: string
  updatedAt: string
}

export interface AlarmInput {
  id?: string
  title: string
  at: string | Date
  taskId?: string
  source?: AlarmSource
}

const MAX_SNOOZE_MINUTES = 24 * 60
const MAX_TITLE = 160

/** Fired when any page creates, edits or cancels a reminder. */
export const ALARMS_CHANGED_EVENT = 'mehr-life:alarms-changed'

export function notifyAlarmsChanged(): void {
  window.dispatchEvent(new CustomEvent(ALARMS_CHANGED_EVENT))
}

export function isAlarmStatus(value: unknown): value is AlarmStatus {
  return ALARM_STATUSES.some((status) => status === value)
}

function alarmError(message: string): RangeError {
  return new RangeError(message)
}

function validIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime()))
    throw alarmError('alarm time is invalid')
  return date.toISOString()
}

export function normalizeAlarmInput(input: AlarmInput): {
  id: string
  title: string
  at: string
  taskId?: string
  source: AlarmSource
} {
  const title = input.title.trim()
  if (!title) throw alarmError('alarm title is required')
  if (title.length > MAX_TITLE) throw alarmError('alarm title is too long')
  return {
    id: input.id?.trim() || createId('alarm'),
    title,
    at: validIso(input.at),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    source: input.source ?? 'manual',
  }
}

/** Whether a scheduled alarm should fire now (one-hour grace on wake-up). */
export function isAlarmDue(
  alarm: Pick<AlarmRecord, 'status' | 'at' | 'firedOccurrence'>,
  now = Date.now(),
  graceMs = 60 * 60 * 1000
): boolean {
  if (alarm.status !== 'scheduled') return false
  if (alarm.firedOccurrence === alarm.at) return false
  const due = Date.parse(alarm.at)
  if (!Number.isFinite(due)) return false
  return due <= now && now - due <= graceMs
}

/** Scheduled alarms that should have fired before the grace window. */
export function isAlarmMissed(
  alarm: Pick<AlarmRecord, 'status' | 'at' | 'firedOccurrence'>,
  now = Date.now(),
  graceMs = 60 * 60 * 1000
): boolean {
  if (alarm.status !== 'scheduled') return false
  if (alarm.firedOccurrence === alarm.at) return false
  const due = Date.parse(alarm.at)
  return Number.isFinite(due) && due + graceMs < now
}

export async function getAlarms(): Promise<AlarmRecord[]> {
  const db = await getDatabase()
  return [...(await getAllRecords<AlarmRecord>(db, STORE_ALARMS))].sort(
    (a, b) => a.at.localeCompare(b.at)
  )
}

export async function getUpcomingAlarms(
  now = Date.now()
): Promise<AlarmRecord[]> {
  return (await getAlarms()).filter(
    (alarm) => alarm.status === 'scheduled' && Date.parse(alarm.at) >= now
  )
}

export async function saveAlarm(input: AlarmInput): Promise<AlarmRecord> {
  const normalized = normalizeAlarmInput(input)
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const existing = rows.find(
    (alarm) =>
      alarm.id === normalized.id ||
      (normalized.taskId !== undefined && alarm.taskId === normalized.taskId)
  )
  const now = new Date().toISOString()
  const record: AlarmRecord = {
    id: existing?.id ?? normalized.id,
    title: normalized.title,
    at: normalized.at,
    ...(normalized.taskId ? { taskId: normalized.taskId } : {}),
    source: normalized.source,
    status: 'scheduled',
    snoozeCount: existing?.snoozeCount ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await putRecords(db, STORE_ALARMS, [record])
  return record
}

export async function deleteAlarm(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_ALARMS, [id])
}

/** Cancels a task's reminder when the task is deleted or its reminder removed. */
export async function cancelTaskAlarm(taskId: string): Promise<void> {
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const matches = rows.filter((alarm) => alarm.taskId === taskId)
  if (matches.length)
    await deleteRecords(
      db,
      STORE_ALARMS,
      matches.map((alarm) => alarm.id)
    )
}

/**
 * Atomically claims one due alarm. Two tabs (or a tab and the companion) may
 * check at the same instant; only the transaction that sees the alarm still
 * un-fired records the occurrence and returns a row.
 */
export async function claimAlarm(
  id: string,
  now = Date.now()
): Promise<AlarmRecord | null> {
  const db = await getDatabase()
  const tx = db.transaction(STORE_ALARMS, 'readwrite')
  const complete = awaitTransaction(tx)
  try {
    const store = tx.objectStore(STORE_ALARMS)
    const alarm = await promisifyRequest<AlarmRecord | undefined>(store.get(id))
    if (!alarm || !isAlarmDue(alarm, now)) {
      await complete
      return null
    }
    const row: AlarmRecord = {
      ...alarm,
      status: 'fired',
      firedOccurrence: alarm.at,
      lastFiredAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }
    store.put(row)
    await complete
    return row
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* already finished */
    }
    throw error
  }
}

export async function snoozeAlarm(
  id: string,
  minutes = 10,
  now = Date.now()
): Promise<AlarmRecord> {
  const safeMinutes = Math.min(
    MAX_SNOOZE_MINUTES,
    Math.max(1, Math.round(minutes))
  )
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const alarm = rows.find((row) => row.id === id)
  if (!alarm) throw alarmError('alarm does not exist')
  const next: AlarmRecord = {
    ...alarm,
    at: new Date(now + safeMinutes * 60_000).toISOString(),
    status: 'scheduled',
    firedOccurrence: undefined,
    snoozeCount: alarm.snoozeCount + 1,
    updatedAt: new Date(now).toISOString(),
  }
  await putRecords(db, STORE_ALARMS, [next])
  return next
}

export async function dismissAlarm(id: string): Promise<void> {
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const alarm = rows.find((row) => row.id === id)
  if (!alarm) return
  await putRecords(db, STORE_ALARMS, [
    { ...alarm, status: 'dismissed', updatedAt: new Date().toISOString() },
  ])
}

/** Cancels one reminder without deleting its history row. */
export async function cancelAlarm(id: string): Promise<void> {
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const alarm = rows.find((row) => row.id === id)
  if (!alarm) return
  await putRecords(db, STORE_ALARMS, [
    { ...alarm, status: 'cancelled', updatedAt: new Date().toISOString() },
  ])
}

/** Marks overdue reminders as missed instead of firing them days later. */
export async function sweepMissedAlarms(now = Date.now()): Promise<number> {
  const db = await getDatabase()
  const rows = await getAllRecords<AlarmRecord>(db, STORE_ALARMS)
  const missed = rows.filter((alarm) => isAlarmMissed(alarm, now))
  if (!missed.length) return 0
  await putRecords(
    db,
    STORE_ALARMS,
    missed.map((alarm) => ({
      ...alarm,
      status: 'missed' as const,
      updatedAt: new Date(now).toISOString(),
    }))
  )
  return missed.length
}
