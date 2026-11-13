import { DB_VERSION, getDatabase, STORE_DEFINITIONS } from '@/services/db'
import {
  clearStores,
  deleteRecords,
  getAllRecords,
  replaceStoreContents,
  type StoreDefinition,
} from '@/services/idb'

export interface DatabaseBackup {
  /** Backup format version of this file. */
  format: 1
  /** Database schema version the backup was taken from. */
  databaseVersion: number
  createdAt: string
  stores: Record<string, unknown[]>
}

/** Approximate space used by this origin, as reported by the browser. */
export interface StorageEstimate {
  usageBytes: number | null
  quotaBytes: number | null
}

const BACKUP_FORMAT = 1

const STORE_BY_NAME = new Map<string, StoreDefinition>(
  STORE_DEFINITIONS.map((definition) => [definition.name, definition])
)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** IndexedDB accepts numbers, strings, dates and arrays of those as keys. */
function isValidKey(value: unknown): value is IDBValidKey {
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (Array.isArray(value)) return value.length > 0 && value.every(isValidKey)
  return false
}

/**
 * Validates an untrusted value (for example a parsed JSON file) and returns a
 * backup that is safe to write.
 *
 * The check happens before the user confirms the import, so an invalid or
 * incompatible file is rejected without touching the existing data.
 */
export function parseBackup(value: unknown): DatabaseBackup {
  if (!isPlainObject(value)) {
    throw new RangeError('The backup file must contain a JSON object')
  }
  if (value.format !== BACKUP_FORMAT) {
    throw new RangeError('Unsupported backup format')
  }
  const databaseVersion = value.databaseVersion
  if (
    typeof databaseVersion !== 'number' ||
    !Number.isInteger(databaseVersion) ||
    databaseVersion < 1
  ) {
    throw new RangeError('The backup does not declare a database version')
  }
  if (databaseVersion > DB_VERSION) {
    throw new RangeError('The backup was created by a newer version of the app')
  }
  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    throw new RangeError('The backup does not declare a valid creation date')
  }
  if (!isPlainObject(value.stores)) {
    throw new RangeError('The backup does not contain any stores')
  }
  const storeEntries = Object.entries(value.stores)
  if (storeEntries.length === 0) {
    throw new RangeError('The backup does not contain any stores')
  }

  const stores: Record<string, unknown[]> = {}
  for (const [storeName, records] of storeEntries) {
    const definition = STORE_BY_NAME.get(storeName)
    if (!definition) {
      throw new RangeError(
        `The backup contains an unknown store "${storeName}"`
      )
    }
    if (!Array.isArray(records)) {
      throw new RangeError(`Records of "${storeName}" must be a list`)
    }
    const keys = new Set<unknown>()
    for (const record of records) {
      if (!isPlainObject(record)) {
        throw new RangeError(`Records of "${storeName}" must be objects`)
      }
      const key = record[definition.keyPath]
      if (!isValidKey(key)) {
        throw new RangeError(
          `A record of "${storeName}" has no valid "${definition.keyPath}" key`
        )
      }
      if (keys.has(key)) {
        throw new RangeError(
          `The backup contains duplicate "${storeName}" records`
        )
      }
      keys.add(key)
    }
    stores[storeName] = records
  }

  return {
    format: BACKUP_FORMAT,
    databaseVersion,
    createdAt: value.createdAt,
    stores,
  }
}

/** Number of records a parsed backup would restore. */
export function countBackupRecords(backup: DatabaseBackup): number {
  return Object.values(backup.stores).reduce(
    (total, records) => total + records.length,
    0
  )
}

/** Reads every store of the local database. */
export async function createBackup(): Promise<DatabaseBackup> {
  const database = await getDatabase()
  const stores: Record<string, unknown[]> = {}
  for (const definition of STORE_DEFINITIONS) {
    stores[definition.name] = await getAllRecords<unknown>(
      database,
      definition.name
    )
  }
  return {
    format: BACKUP_FORMAT,
    databaseVersion: DB_VERSION,
    createdAt: new Date().toISOString(),
    stores,
  }
}

/**
 * Restores a backup.
 *
 * The file is validated before anything is written and every store contained in
 * the file is replaced inside one transaction, so a failed import aborts and
 * leaves the previous data untouched. The schema itself is never changed.
 */
export async function restoreBackup(input: unknown): Promise<number> {
  const backup = parseBackup(input)
  const database = await getDatabase()
  const contents = Object.entries(backup.stores).map(
    ([storeName, records]) => ({ storeName, records })
  )
  await replaceStoreContents(database, contents)
  return countBackupRecords(backup)
}

/** Removes every record of the database while keeping the schema. */
export async function clearAllData(): Promise<void> {
  const database = await getDatabase()
  await clearStores(
    database,
    STORE_DEFINITIONS.map((definition) => definition.name)
  )
}

/**
 * Best-effort size of the local data.
 *
 * IndexedDB has no API for the byte size of a single database, so the browser
 * storage estimate (which also counts caches of this origin) is reported and
 * stays `null` when the API is unavailable.
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null }
  }
  try {
    const estimate = await navigator.storage.estimate()
    return {
      usageBytes: typeof estimate.usage === 'number' ? estimate.usage : null,
      quotaBytes: typeof estimate.quota === 'number' ? estimate.quota : null,
    }
  } catch {
    return { usageBytes: null, quotaBytes: null }
  }
}

/** Removes a single record; used by tests and the maintenance tools. */
export async function removeRecord(
  storeName: string,
  id: string
): Promise<void> {
  const database = await getDatabase()
  await deleteRecords(database, storeName, [id])
}
