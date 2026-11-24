import { afterEach, describe, expect, it } from 'vitest'
import {
  countBackupRecords,
  parseBackup,
  restoreBackup,
  type DatabaseBackup,
} from '@/services/backup'
import {
  DB_VERSION,
  destroyDatabase,
  getDatabase,
  getFinanceEntries,
  initializeOfflineStorage,
  saveFinanceEntry,
} from '@/services/db'
import {
  deleteDatabase,
  getAllRecords,
  openDatabase,
  putRecord,
  putRecords,
  replaceStoreContents,
  type StoreDefinition,
} from '@/services/idb'
import { STORE_META } from '@/services/stores'

/**
 * These tests never touch a user profile. Raw IndexedDB cases use databases
 * with a dedicated `…-test-…` prefix; backup/restore cases use the browser
 * test profile that Vitest creates for the suite.
 */
const TEST_DB_PREFIX = 'mehr-life-os-test-'
const openedTestDatabases: string[] = []
let sequence = 0

function freshTestDatabaseName(): string {
  sequence += 1
  const name = `${TEST_DB_PREFIX}${Date.now()}-${sequence}`
  openedTestDatabases.push(name)
  return name
}

const ITEM_STORE: StoreDefinition = {
  name: 'items',
  keyPath: 'id',
  indexes: [{ name: 'by_code', keyPath: 'code', options: { unique: true } }],
}

interface TestItem {
  id: string
  code: string
}

function legacyBackup(stores: Record<string, unknown[]>): DatabaseBackup {
  return {
    format: 1,
    databaseVersion: 1,
    createdAt: new Date().toISOString(),
    stores,
  }
}

afterEach(async () => {
  for (const name of openedTestDatabases.splice(0)) {
    await deleteDatabase(name)
  }
})

describe('offline storage resilience (test databases only)', () => {
  it('closes an open connection when a versionchange upgrade is requested', async () => {
    const name = freshTestDatabaseName()
    const first = await openDatabase(name, 1, [ITEM_STORE])
    let versionChangeSeen = false
    first.addEventListener('versionchange', () => {
      versionChangeSeen = true
    })

    const second = await openDatabase(name, 2, [
      ITEM_STORE,
      { name: 'extra', keyPath: 'id', indexes: [] },
    ])

    expect(versionChangeSeen).toBe(true)
    expect(() => first.transaction('items', 'readonly')).toThrow()
    expect(second.objectStoreNames.contains('extra')).toBe(true)
    second.close()
  })

  it('resolves deleteDatabase when a foreign connection blocks it', async () => {
    const name = freshTestDatabaseName()
    const blocking = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('items', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    // The current implementation resolves on `onblocked` instead of hanging.
    await expect(deleteDatabase(name)).resolves.toBeUndefined()

    blocking.close()
    await deleteDatabase(name)
  }, 10_000)

  it('keeps every record when independent writes run concurrently', async () => {
    const name = freshTestDatabaseName()
    const database = await openDatabase(name, 1, [ITEM_STORE])
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        putRecord<TestItem>(database, 'items', {
          id: `item-${index}`,
          code: `CODE-${index}`,
        })
      )
    )

    const rows = await getAllRecords<TestItem>(database, 'items')
    expect(rows).toHaveLength(12)
    expect(new Set(rows.map((row) => row.id)).size).toBe(12)
    database.close()
  })

  it('leaves one consistent value for a concurrent read-modify-write', async () => {
    const name = freshTestDatabaseName()
    const database = await openDatabase(name, 1, [ITEM_STORE])
    await putRecord<TestItem>(database, 'items', {
      id: 'counter',
      code: 'START',
    })

    // Two independent transactions read the same value and write it back.
    // IndexedDB serialises the transactions, so the last committed writer wins.
    const writers = await Promise.all([
      (async () => {
        const current = await getAllRecords<TestItem>(database, 'items')
        await putRecord<TestItem>(database, 'items', {
          ...current[0]!,
          code: 'WRITER-A',
        })
      })(),
      (async () => {
        const current = await getAllRecords<TestItem>(database, 'items')
        await putRecord<TestItem>(database, 'items', {
          ...current[0]!,
          code: 'WRITER-B',
        })
      })(),
    ])
    expect(writers).toHaveLength(2)

    const final = await getAllRecords<TestItem>(database, 'items')
    expect(final).toHaveLength(1)
    expect(['WRITER-A', 'WRITER-B']).toContain(final[0]?.code)
    database.close()
  })

  it('rejects a tampered backup before any data is written', async () => {
    const valid = legacyBackup({ [STORE_META]: [{ key: 'k', value: 'v' }] })
    const tampered: unknown[] = [
      { ...valid, format: '1' },
      { ...valid, databaseVersion: DB_VERSION + 1 },
      { ...valid, databaseVersion: Number.NaN },
      { ...valid, createdAt: 123 },
      { ...valid, stores: { meta: 'not-a-list' } },
      { ...valid, stores: { meta: [{ key: null, value: 'bad key type' }] } },
      { ...valid, stores: { meta: [{ key: 'a' }, { key: 'a' }] } },
      { ...valid, stores: { totallyUnknownStore: [] } },
    ]
    for (const file of tampered) {
      expect(() => parseBackup(file)).toThrow(RangeError)
    }
  })

  it('keeps existing records when an imported store fails mid-transaction', async () => {
    const name = freshTestDatabaseName()
    const database = await openDatabase(name, 1, [ITEM_STORE])
    await putRecords<TestItem>(database, 'items', [
      { id: 'a', code: 'A' },
      { id: 'b', code: 'B' },
    ])

    // The second replacement record repeats the unique `code` of the first,
    // forcing the whole read/write transaction to abort.
    await expect(
      replaceStoreContents(database, [
        {
          storeName: 'items',
          records: [
            { id: 'x', code: 'X' },
            { id: 'y', code: 'X' },
          ],
        },
      ])
    ).rejects.toBeInstanceOf(Error)

    const rows = await getAllRecords<TestItem>(database, 'items')
    expect(rows.map((row) => row.id).sort()).toEqual(['a', 'b'])
    database.close()
  })

  it('imports an older database version and a partial backup without wiping other stores', async () => {
    await destroyDatabase()
    await initializeOfflineStorage()
    await saveFinanceEntry({
      type: 'expense',
      amount: 12_000,
      date: '2026-02-05',
      title: 'Kept entry',
      category: 'food',
    })
    const before = await getFinanceEntries('2026-02')
    expect(before).toHaveLength(1)

    const partial = legacyBackup({
      [STORE_META]: [{ key: 'legacy-import', value: 'ok' }],
    })
    expect(countBackupRecords(partial)).toBe(1)
    expect(parseBackup(partial).databaseVersion).toBe(1)

    await expect(restoreBackup(partial)).resolves.toBe(1)

    const meta = await getAllRecords<{ key: string; value: string }>(
      await getDatabase(),
      STORE_META
    )
    expect(meta.some((row) => row.key === 'legacy-import')).toBe(true)
    expect(await getFinanceEntries('2026-02')).toEqual(before)
  })
})
