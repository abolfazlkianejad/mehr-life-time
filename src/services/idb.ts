/**
 * Thin promise wrapper around native IndexedDB.
 *
 * The offline engine intentionally avoids a third-party wrapper: the surface we
 * need (open/upgrade, indexed range reads, single-transaction writes) is small
 * enough that keeping it dependency-free is cheaper than maintaining an extra
 * runtime in the bundle.
 */

export interface IndexDefinition {
  name: string
  keyPath: string | string[]
  options?: IDBIndexParameters
}

export interface StoreDefinition {
  name: string
  keyPath: string
  indexes: IndexDefinition[]
}

export class OfflineStorageError extends Error {
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'OfflineStorageError'
    this.cause = cause
  }
}

export function isIndexedDbAvailable(): boolean {
  return typeof globalThis.indexedDB !== 'undefined'
}

/** Resolves with `request.result`, rejects with the request error. */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new OfflineStorageError('IndexedDB request failed', request.error))
  })
}

/** Resolves when the transaction commits, rejects on error/abort. */
export function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(
        new OfflineStorageError(
          'IndexedDB transaction failed',
          transaction.error
        )
      )
    transaction.onabort = () =>
      reject(
        new OfflineStorageError(
          'IndexedDB transaction aborted',
          transaction.error
        )
      )
  })
}

export function openDatabase(
  name: string,
  version: number,
  stores: StoreDefinition[]
): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(
      new OfflineStorageError('IndexedDB is not available in this environment')
    )
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, version)

    request.onupgradeneeded = () => {
      const database = request.result
      for (const definition of stores) {
        const store = database.objectStoreNames.contains(definition.name)
          ? request.transaction?.objectStore(definition.name)
          : database.createObjectStore(definition.name, {
              keyPath: definition.keyPath,
            })
        if (!store) continue

        for (const index of definition.indexes) {
          if (store.indexNames.contains(index.name)) continue
          store.createIndex(index.name, index.keyPath, index.options)
        }
      }
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () =>
      reject(
        new OfflineStorageError(
          `Failed to open database "${name}"`,
          request.error
        )
      )
    request.onblocked = () =>
      reject(
        new OfflineStorageError(
          `Opening database "${name}" is blocked by another connection`
        )
      )
  })
}

export function deleteDatabase(name: string): Promise<void> {
  if (!isIndexedDbAvailable()) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(
        new OfflineStorageError(
          `Failed to delete database "${name}"`,
          request.error
        )
      )
    request.onblocked = () => resolve()
  })
}

function storeOf(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode
): { store: IDBObjectStore; transaction: IDBTransaction } {
  const transaction = database.transaction(storeName, mode)
  return { store: transaction.objectStore(storeName), transaction }
}

export async function getAllRecords<T>(
  database: IDBDatabase,
  storeName: string,
  query?: IDBValidKey | IDBKeyRange,
  count?: number
): Promise<T[]> {
  const { store, transaction } = storeOf(database, storeName, 'readonly')
  const records = await promisifyRequest<T[]>(
    count === undefined ? store.getAll(query) : store.getAll(query, count)
  )
  await awaitTransaction(transaction)
  return records
}

export async function getAllFromIndex<T>(
  database: IDBDatabase,
  storeName: string,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange,
  count?: number
): Promise<T[]> {
  const { store, transaction } = storeOf(database, storeName, 'readonly')
  const index = store.index(indexName)
  const records = await promisifyRequest<T[]>(
    count === undefined ? index.getAll(query) : index.getAll(query, count)
  )
  await awaitTransaction(transaction)
  return records
}

export async function getRecord<T>(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<T | undefined> {
  const { store, transaction } = storeOf(database, storeName, 'readonly')
  const record = await promisifyRequest<T | undefined>(store.get(key))
  await awaitTransaction(transaction)
  return record
}

export async function countRecords(
  database: IDBDatabase,
  storeName: string,
  indexName?: string,
  query?: IDBValidKey | IDBKeyRange
): Promise<number> {
  const { store, transaction } = storeOf(database, storeName, 'readonly')
  const target = indexName ? store.index(indexName) : store
  const total = await promisifyRequest<number>(target.count(query))
  await awaitTransaction(transaction)
  return total
}

export async function putRecords<T>(
  database: IDBDatabase,
  storeName: string,
  values: T[]
): Promise<void> {
  if (values.length === 0) return
  const { store, transaction } = storeOf(database, storeName, 'readwrite')
  for (const value of values) {
    store.put(value)
  }
  await awaitTransaction(transaction)
}

export async function putRecord<T>(
  database: IDBDatabase,
  storeName: string,
  value: T
): Promise<void> {
  await putRecords(database, storeName, [value])
}

export async function deleteRecords(
  database: IDBDatabase,
  storeName: string,
  keys: IDBValidKey[]
): Promise<void> {
  if (keys.length === 0) return
  const { store, transaction } = storeOf(database, storeName, 'readwrite')
  for (const key of keys) {
    store.delete(key)
  }
  await awaitTransaction(transaction)
}

export async function clearStores(
  database: IDBDatabase,
  storeNames: string[]
): Promise<void> {
  if (storeNames.length === 0) return
  const transaction = database.transaction(storeNames, 'readwrite')
  for (const storeName of storeNames) {
    transaction.objectStore(storeName).clear()
  }
  await awaitTransaction(transaction)
}

/**
 * Replaces the contents of several stores in a single transaction.
 *
 * Either every store is cleared and refilled, or - when a record can not be
 * written - the transaction aborts and the database keeps its previous state.
 * This is what makes a backup import safe: a broken file never leaves the user
 * with half of their data.
 */
export async function replaceStoreContents(
  database: IDBDatabase,
  contents: Array<{ storeName: string; records: unknown[] }>
): Promise<void> {
  if (contents.length === 0) return
  const transaction = database.transaction(
    contents.map((entry) => entry.storeName),
    'readwrite'
  )
  const done = awaitTransaction(transaction)
  try {
    for (const { storeName, records } of contents) {
      const store = transaction.objectStore(storeName)
      store.clear()
      for (const record of records) {
        store.put(record)
      }
    }
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // The transaction may already have finished; the original error wins.
    }
    await done.catch(() => undefined)
    throw new OfflineStorageError('Failed to replace stored records', error)
  }
  await done
}
