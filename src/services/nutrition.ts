import { toDateKey } from '@/lib/date-key'
import { createId } from '@/lib/id'
import { getDatabase } from '@/services/db'
import { STORE_CARDIO_LOGS } from '@/services/stores'
import {
  deleteRecords,
  getAllFromIndex,
  getAllRecords,
  getRecord,
  putRecords,
} from '@/services/idb'

/**
 * A cardio / activity session that burns calories.
 *
 * The calorie value is either typed by the user or calculated with the MET
 * formula (see `src/features/nutrition/nutrition-utils.ts`). Estimated values
 * stay flagged so the nutrition module can label them.
 */
export interface CardioLog {
  id: string
  dateKey: string
  activity: string
  minutes: number
  calories: number
  /** `true` when the calorie value came from a formula instead of the user. */
  caloriesEstimated: boolean
  createdAt: string
}

export type CardioLogInput = Omit<
  CardioLog,
  'id' | 'dateKey' | 'createdAt'
> & { id?: string; date?: string | number | Date }

function buildCardioLog(
  input: CardioLogInput,
  base?: CardioLog
): CardioLog {
  if (!input.activity.trim()) throw new RangeError('activity is required')
  if (!Number.isInteger(input.minutes) || input.minutes < 1) {
    throw new RangeError('minutes must be a positive whole number')
  }
  if (!Number.isSafeInteger(input.calories) || input.calories < 0) {
    throw new RangeError('calories must be a non-negative whole number')
  }
  const now = new Date().toISOString()
  const dateKey = input.date ? toDateKey(input.date) : (base?.dateKey ?? toDateKey(new Date()))
  return {
    id: base?.id ?? input.id ?? createId('cardio'),
    dateKey,
    activity: input.activity.trim(),
    minutes: input.minutes,
    calories: input.calories,
    caloriesEstimated: input.caloriesEstimated,
    createdAt: base?.createdAt ?? now,
  }
}

export async function getCardioLogs(
  date: string | number | Date = new Date()
): Promise<CardioLog[]> {
  const db = await getDatabase()
  const rows = await getAllFromIndex<CardioLog>(
    db,
    STORE_CARDIO_LOGS,
    'by_date_key',
    toDateKey(date)
  )
  return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getCardioLogsByRange(
  from: string | number | Date,
  to: string | number | Date
): Promise<CardioLog[]> {
  const db = await getDatabase()
  const rows = await getAllRecords<CardioLog>(db, STORE_CARDIO_LOGS)
  const fromKey = toDateKey(from)
  const toKey = toDateKey(to)
  return rows
    .filter((row) => row.dateKey >= fromKey && row.dateKey <= toKey)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt.localeCompare(b.createdAt))
}

export async function saveCardioLog(input: CardioLogInput): Promise<CardioLog> {
  const db = await getDatabase()
  const base = input.id
    ? await getRecord<CardioLog>(db, STORE_CARDIO_LOGS, input.id)
    : undefined
  const record = buildCardioLog(input, base)
  await putRecords(db, STORE_CARDIO_LOGS, [record])
  return record
}

export async function updateCardioLog(
  id: string,
  patch: Partial<CardioLogInput>
): Promise<CardioLog> {
  const db = await getDatabase()
  const base = await getRecord<CardioLog>(db, STORE_CARDIO_LOGS, id)
  if (!base) throw new RangeError(`Cardio session "${id}" does not exist`)
  const record = buildCardioLog({ ...base, ...patch, id }, base)
  await putRecords(db, STORE_CARDIO_LOGS, [record])
  return record
}

export async function deleteCardioLog(id: string): Promise<void> {
  const db = await getDatabase()
  await deleteRecords(db, STORE_CARDIO_LOGS, [id])
}
