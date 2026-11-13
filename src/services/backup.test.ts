import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllData,
  countBackupRecords,
  createBackup,
  getStorageEstimate,
  parseBackup,
  restoreBackup,
  type DatabaseBackup,
} from '@/services/backup'
import {
  DB_VERSION,
  destroyDatabase,
  getFinanceEntries,
  getOpportunityRecords,
  getStoreCounts,
  initializeOfflineStorage,
  saveFinanceEntry,
  saveOpportunityRecord,
  STORE_DEFINITIONS,
} from '@/services/db'

function asJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function addSampleRecords(): Promise<void> {
  await saveFinanceEntry({
    type: 'expense',
    amount: 120000,
    date: '2026-01-10',
    title: 'Coffee',
    category: 'food',
  })
  await saveOpportunityRecord({
    kind: 'job',
    platform: 'example',
    title: 'Backend developer',
    url: 'https://example.com/jobs/1',
    skills: ['typescript'],
  })
}

describe('local data backup', () => {
  beforeEach(async () => {
    await destroyDatabase()
    await initializeOfflineStorage()
  })

  it('exports every store of the database', async () => {
    const backup = await createBackup()

    expect(Object.keys(backup.stores).sort()).toEqual(
      STORE_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(backup.format).toBe(1)
    expect(backup.databaseVersion).toBe(DB_VERSION)
    expect(Number.isNaN(Date.parse(backup.createdAt))).toBe(false)
  })

  it('restores records after a reset', async () => {
    await addSampleRecords()
    const backup = await createBackup()
    // The test browser may already hold migrated data from other suites, so the
    // assertion is tied to the stores this test writes.
    expect(backup.stores.financeEntries).toHaveLength(1)
    expect(backup.stores.radarItems).toHaveLength(1)
    const expectedRecords = countBackupRecords(backup)

    await clearAllData()
    expect(Object.values(await getStoreCounts()).every((count) => count === 0)).toBe(true)

    const restored = await restoreBackup(asJson(backup))
    expect(restored).toBe(expectedRecords)

    const entries = await getFinanceEntries('2026-01')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.title).toBe('Coffee')

    const opportunities = await getOpportunityRecords()
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0]?.url).toBe('https://example.com/jobs/1')
  })

  it('rejects invalid or incompatible files and keeps the current data', async () => {
    await addSampleRecords()
    const before = await getStoreCounts()
    const valid = await createBackup()
    const createdAt = new Date().toISOString()

    const invalidFiles: unknown[] = [
      null,
      'not a backup',
      [],
      {},
      { ...valid, format: 2 },
      { ...valid, databaseVersion: DB_VERSION + 1 },
      { ...valid, databaseVersion: 'ten' },
      { ...valid, createdAt: 'yesterday' },
      { ...valid, stores: null },
      { ...valid, stores: {} },
      {
        format: 1,
        databaseVersion: 1,
        createdAt,
        stores: { unknownStore: [] },
      },
      {
        format: 1,
        databaseVersion: 1,
        createdAt,
        stores: { meta: [{ key: '' }] },
      },
      {
        format: 1,
        databaseVersion: 1,
        createdAt,
        stores: { meta: [{ key: 'a' }, { key: 'a' }] },
      },
      {
        format: 1,
        databaseVersion: 1,
        createdAt,
        stores: { meta: [{ value: 'missing key' }] },
      },
    ]

    for (const invalid of invalidFiles) {
      expect(() => parseBackup(invalid)).toThrow(RangeError)
      await expect(restoreBackup(invalid)).rejects.toBeInstanceOf(RangeError)
    }

    expect(await getStoreCounts()).toEqual(before)
    expect(await getFinanceEntries('2026-01')).toHaveLength(1)
    expect(await getOpportunityRecords()).toHaveLength(1)
  })

  it('aborts the whole import when a store can not be written', async () => {
    await addSampleRecords()
    const before = await getStoreCounts()
    const backup = asJson(await createBackup()) as DatabaseBackup

    // The finance store is emptied, and the radar store gets a second record
    // with the same URL, which violates its unique index. The transaction must
    // abort, so the emptied finance store is not committed either.
    backup.stores.financeEntries = []
    const radarRecords = backup.stores.radarItems ?? []
    const first = radarRecords[0] as Record<string, unknown> | undefined
    expect(first).toBeDefined()
    radarRecords.push({ ...first, id: 'opportunity-duplicate-url' })
    backup.stores.radarItems = radarRecords

    await expect(restoreBackup(backup)).rejects.toBeInstanceOf(Error)

    expect(await getStoreCounts()).toEqual(before)
    expect(await getFinanceEntries('2026-01')).toHaveLength(1)
    expect(await getOpportunityRecords()).toHaveLength(1)
  })

  it('clears every store on reset while keeping the schema', async () => {
    await addSampleRecords()
    await clearAllData()

    const counts = await getStoreCounts()
    expect(Object.keys(counts).sort()).toEqual(
      STORE_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(Object.values(counts).every((count) => count === 0)).toBe(true)
  })

  it('reports a storage estimate without failing', async () => {
    const estimate = await getStorageEstimate()
    expect(estimate).toHaveProperty('usageBytes')
    expect(estimate).toHaveProperty('quotaBytes')
  })
})
