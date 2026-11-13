import { beforeEach, describe, expect, it } from 'vitest'
import {
  destroyDatabase,
  getDatabase,
  initializeOfflineStorage,
  STORE_EDUCATION_ITEMS,
} from '@/services/db'
import { getAllRecords, putRecords } from '@/services/idb'
import {
  deleteEducationItem,
  educationItemCreatedTime,
  getEducationItems,
  normalizeEducationItem,
  saveEducationItem,
  updateEducationItem,
} from '@/services/learning'

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage(new Date(2026, 0, 15, 9, 0, 0))
}

describe('education course service', () => {
  beforeEach(freshDatabase)

  it('saves master, university and training courses independently', async () => {
    const masters = await saveEducationItem({
      track: 'masters',
      type: 'course',
      title: '  آمار کاربردی  ',
      description: 'درس اصلی',
      status: 'active',
      progress: 0,
      resources: 'کتاب آمار',
    })
    const university = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'Econometrics',
      status: 'planned',
      progress: 0,
      credits: 3,
      professor: 'دکتر رضایی',
      semester: 'نیم‌سال اول ۱۴۰۵',
    })
    const training = await saveEducationItem({
      track: 'course',
      type: 'course',
      title: 'Advanced React',
      status: 'active',
      progress: 35,
      instructor: 'علی محمدی',
      platform: 'یوتیوب',
      url: 'https://example.com/react',
      estimatedHours: 12.5,
    })

    expect(masters.title).toBe('آمار کاربردی')
    expect(masters.resources).toBe('کتاب آمار')
    expect(masters.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(university.credits).toBe(3)
    expect(training.url).toBe('https://example.com/react')
    expect(training.estimatedHours).toBe(12.5)

    expect((await getEducationItems('masters')).map((item) => item.id)).toEqual([masters.id])
    expect((await getEducationItems('university')).map((item) => item.id)).toEqual([
      university.id,
    ])
    expect((await getEducationItems('course')).map((item) => item.id)).toEqual([training.id])
    expect(await getEducationItems()).toHaveLength(3)
  })

  it('edits a course without changing its creation time or other paths', async () => {
    const saved = await saveEducationItem({
      track: 'masters',
      type: 'course',
      title: 'روش تحقیق',
      status: 'planned',
      progress: 0,
      resources: 'جزوه',
    })
    const other = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'اقتصاد خرد',
      status: 'planned',
      progress: 0,
      credits: 3,
    })

    const edited = await updateEducationItem(saved.id, {
      title: 'روش تحقیق پیشرفته',
      resources: 'جزوه و کتاب',
    })

    expect(edited.id).toBe(saved.id)
    expect(edited.title).toBe('روش تحقیق پیشرفته')
    expect(edited.createdAt).toBe(saved.createdAt)
    expect((await getEducationItems('university')).map((item) => item.id)).toEqual([
      other.id,
    ])

    await deleteEducationItem(saved.id)
    expect(await getEducationItems('masters')).toHaveLength(0)
    expect(await getEducationItems('university')).toHaveLength(1)
  })

  it('rejects invalid credits, URLs and empty titles', async () => {
    await expect(
      saveEducationItem({
        track: 'university',
        type: 'course',
        title: 'درس',
        status: 'planned',
        progress: 0,
        credits: 61,
      })
    ).rejects.toThrow(/credits/)
    await expect(
      saveEducationItem({
        track: 'course',
        type: 'course',
        title: 'دوره',
        status: 'planned',
        progress: 0,
        url: 'ftp://example.com/file',
      })
    ).rejects.toThrow(/URL/)
    await expect(
      saveEducationItem({
        track: 'masters',
        type: 'course',
        title: '   ',
        status: 'planned',
        progress: 0,
      })
    ).rejects.toThrow(/title/)
  })

  it('never lets one legacy row break the course list', async () => {
    const valid = await saveEducationItem({
      track: 'masters',
      type: 'course',
      title: 'درس سالم',
      status: 'planned',
      progress: 0,
    })
    const db = await getDatabase()
    const epoch = new Date(1700000000000)
    await putRecords(db, STORE_EDUCATION_ITEMS, [
      // Legacy row without any timestamp.
      {
        id: 'legacy_no_date',
        track: 'masters',
        type: 'course',
        title: 'بدون تاریخ',
        status: 'planned',
        progress: 0,
      },
      // Legacy row with an epoch number instead of ISO text.
      {
        id: 'legacy_epoch',
        track: 'masters',
        type: 'course',
        title: 'تاریخ عددی',
        status: 'planned',
        progress: 0,
        createdAt: epoch.getTime(),
        updatedAt: epoch.getTime(),
      },
      // First-generation track name.
      {
        id: 'legacy_ml',
        track: 'ml',
        type: 'course',
        title: 'مسیر قدیمی',
        status: 'planned',
        progress: 0,
        createdAt: epoch.toISOString(),
        updatedAt: epoch.toISOString(),
      },
      // Completely unknown row: skipped, but kept in the store.
      {
        id: 'legacy_unknown',
        track: 'unknown',
        title: 'ناشناخته',
      },
    ])

    const items = await getEducationItems()
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([valid.id, 'legacy_no_date', 'legacy_epoch', 'legacy_ml'])
    )
    expect(items.map((item) => item.id)).not.toContain('legacy_unknown')

    const noDate = items.find((item) => item.id === 'legacy_no_date')
    expect(noDate?.createdAt).toBe('')
    expect(educationItemCreatedTime(noDate!)).toBe(0)

    const legacyEpoch = items.find((item) => item.id === 'legacy_epoch')
    expect(legacyEpoch?.createdAt).toBe(epoch.toISOString())

    const legacyMl = items.find((item) => item.id === 'legacy_ml')
    expect(legacyMl?.track).toBe('masters')

    // Reading is defensive only: the stored rows are not rewritten.
    const stored = await getAllRecords<{ id: string; createdAt?: unknown }>(
      db,
      STORE_EDUCATION_ITEMS
    )
    expect(stored).toHaveLength(5)
    expect(stored.find((row) => row.id === 'legacy_no_date')?.createdAt).toBeUndefined()
  })

  it('normalizes malformed rows for display without throwing', () => {
    expect(normalizeEducationItem(null)).toBeNull()
    expect(normalizeEducationItem({ title: 'بدون شناسه' })).toBeNull()
    expect(
      normalizeEducationItem({
        id: 'row',
        track: 'exam',
        title: '  درس  ',
        status: 'weird',
        type: 'weird',
        progress: 250,
        createdAt: 'not-a-date',
      })
    ).toMatchObject({
      id: 'row',
      track: 'university',
      title: 'درس',
      status: 'planned',
      type: 'course',
      progress: 100,
      createdAt: '',
    })
  })
})
