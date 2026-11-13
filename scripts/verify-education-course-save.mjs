import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

/**
 * End-to-end verification of saving courses in all three education paths,
 * especially the master's path that was reported as not persisting.
 *
 * Runs in a brand-new browser profile, so the developer's real IndexedDB data
 * is never touched. Start the app first, then:
 *
 *   node scripts/verify-education-course-save.mjs http://localhost:5199
 */
const baseUrl = process.argv[2] ?? 'http://localhost:5199'
const browser = await chromium.launch({ headless: true })
const pageErrors = []

const readItems = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mehr-life-os')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('educationItems', 'readonly')
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore('educationItems').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  })

async function newPage({ viewport, language }) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(
    (lang) => window.localStorage.setItem('app-language', lang),
    language
  )
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  page.on('dialog', (dialog) => dialog.accept())
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${baseUrl}/education`, { waitUntil: 'networkidle' })
  return { context, page }
}

const cardFor = (page, title) =>
  page
    .locator('div.rounded-lg.border.p-3')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()

const assertNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  )
  assert.equal(overflow, false, 'the education page must not scroll horizontally')
}

try {
  const { context, page } = await newPage({
    viewport: { width: 1360, height: 960 },
    language: 'fa',
  })

  // 1. A master's course with a Persian name and resources.
  await page.getByLabel('نام دوره', { exact: true }).fill('ساختمان داده')
  await page.getByLabel('منابع و کتاب‌ها').fill('CLRS، جزوه استاد')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('ساختمان داده', { exact: true }).first().waitFor()
  await page.getByText('CLRS، جزوه استاد', { exact: false }).waitFor()
  let items = await readItems(page)
  assert.equal(items.length, 1, 'exactly one master course is stored')
  assert.equal(items[0].track, 'masters')
  assert.equal(items[0].resources, 'CLRS، جزوه استاد')
  assert.match(items[0].createdAt, /^\d{4}-\d{2}-\d{2}T/, 'creation time is stored')

  // 2. A master's course with an English name.
  await page.getByLabel('نام دوره', { exact: true }).fill('Data Structures')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('Data Structures', { exact: true }).first().waitFor()
  items = await readItems(page)
  assert.equal(items.length, 2)
  assert.ok(items.some((item) => item.title === 'Data Structures'))

  // 3. Empty submit shows a localized message and stores nothing.
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'نام درس یا دوره را وارد کنید.' })
    .waitFor()
  assert.equal((await readItems(page)).length, 2, 'empty submit must not create a row')

  // 4. Refresh keeps both courses.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('ساختمان داده', { exact: true }).first().waitFor()
  await page.getByText('Data Structures', { exact: true }).first().waitFor()
  items = await readItems(page)
  assert.equal(items.length, 2, 'courses survive a full page reload')

  // 5. Edit the Persian course; the record keeps its id and creation time.
  const persianBefore = items.find((item) => item.title === 'ساختمان داده')
  await cardFor(page, 'ساختمان داده')
    .getByRole('button', { name: 'ویرایش مورد' })
    .click()
  await page.getByLabel('نام دوره', { exact: true }).fill('ساختمان داده پیشرفته')
  await page.getByLabel('منابع و کتاب‌ها').fill('CLRS ویرایش سوم')
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات' }).click()
  await page.getByText('ساختمان داده پیشرفته', { exact: true }).first().waitFor()
  items = await readItems(page)
  const persianAfter = items.find((item) => item.id === persianBefore.id)
  assert.ok(persianAfter, 'the edited course keeps its record')
  assert.equal(persianAfter.title, 'ساختمان داده پیشرفته')
  assert.equal(persianAfter.createdAt, persianBefore.createdAt)
  assert.equal(persianAfter.resources, 'CLRS ویرایش سوم')

  // 6. Delete the English course without touching the Persian one.
  await cardFor(page, 'Data Structures')
    .getByRole('button', { name: 'حذف مورد' })
    .click()
  await page.getByText('Data Structures', { exact: true }).waitFor({ state: 'detached' })
  items = await readItems(page)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'ساختمان داده پیشرفته')

  // 7. University and training paths still save without regression.
  await page.getByRole('tab', { name: 'دروس دانشگاه' }).click()
  await page.getByLabel('نام دوره', { exact: true }).fill('اقتصاد خرد')
  await page.getByLabel('تعداد واحد').fill('3')
  await page.getByLabel('استاد').fill('دکتر رضایی')
  await page.getByLabel('نیم‌سال').fill('نیم‌سال اول ۱۴۰۵')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('اقتصاد خرد', { exact: true }).first().waitFor()

  await page.getByRole('tab', { name: 'دوره‌های آموزشی' }).click()
  await page.getByLabel('نام دوره', { exact: true }).fill('React حرفه‌ای')
  await page.getByLabel('مدرس').fill('علی محمدی')
  await page.getByLabel('پلتفرم').fill('یوتیوب')
  await page.getByLabel('ساعت برآوردی').fill('12.5')
  await page.getByLabel('پیشرفت (٪)').fill('35')
  await page.getByLabel('نشانی دوره').fill('https://example.com/react')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('React حرفه‌ای', { exact: true }).first().waitFor()
  await page.getByText('https://example.com/react').waitFor()

  items = await readItems(page)
  assert.equal(items.filter((item) => item.track === 'university').length, 1)
  const training = items.find((item) => item.track === 'course')
  assert.equal(training?.credits, undefined)
  assert.equal(training?.estimatedHours, 12.5)
  assert.equal(training?.progress, 35)

  // 8. A double click can not create a duplicate master's course.
  await page.getByRole('tab', { name: 'آموزش ارشد' }).click()
  await page.getByLabel('نام دوره', { exact: true }).fill('دوبار کلیک')
  await page.getByRole('button', { name: 'افزودن مورد' }).dblclick()
  await page.getByText('دوبار کلیک', { exact: true }).first().waitFor()
  await page.waitForTimeout(800)
  items = await readItems(page)
  assert.equal(
    items.filter((item) => item.title === 'دوبار کلیک').length,
    1,
    'double submit must store exactly one record'
  )

  // 9. A malformed legacy row may not hide the list or block new saves.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mehr-life-os')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('educationItems', 'readwrite')
      const store = transaction.objectStore('educationItems')
      store.put({
        id: 'legacy_no_date',
        track: 'masters',
        type: 'course',
        title: 'قدیمی بدون تاریخ',
        status: 'planned',
        progress: 0,
      })
      store.put({
        id: 'legacy_epoch',
        track: 'masters',
        type: 'course',
        title: 'قدیمی با تاریخ عددی',
        status: 'planned',
        progress: 0,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      })
      store.put({
        id: 'legacy_ml_track',
        track: 'ml',
        type: 'course',
        title: 'مسیر نسل اول',
        status: 'planned',
        progress: 0,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      })
      store.put({ id: 'legacy_unknown', track: 'unknown', title: 'ردیف ناشناخته' })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('ساختمان داده پیشرفته', { exact: true }).first().waitFor()
  assert.equal(
    await page.getByText('بارگذاری بخش آموزش انجام نشد.', { exact: false }).count(),
    0,
    'a legacy row must not break the load'
  )
  await page.getByText('قدیمی بدون تاریخ', { exact: true }).first().waitFor()
  await page.getByText('مسیر نسل اول', { exact: true }).first().waitFor()
  assert.equal(
    await page.getByText('ردیف ناشناخته', { exact: true }).count(),
    0,
    'an unknown track is not shown in a wrong path'
  )

  await page.getByLabel('نام دوره', { exact: true }).fill('بعد از داده قدیمی')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('بعد از داده قدیمی', { exact: true }).first().waitFor()
  items = await readItems(page)
  assert.ok(items.some((item) => item.title === 'بعد از داده قدیمی'))
  // The malformed legacy rows are still in the store: reading is read-only.
  assert.ok(items.some((item) => item.id === 'legacy_no_date'))

  await page.screenshot({
    path: path.join(os.tmpdir(), 'education-course-save-fa-desktop.png'),
    fullPage: true,
  })

  // 10. Persian mobile layout.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('نام دوره', { exact: true }).waitFor()
  await assertNoHorizontalOverflow(page)
  await page.screenshot({
    path: path.join(os.tmpdir(), 'education-course-save-fa-mobile.png'),
    fullPage: true,
  })

  await context.close()

  // 11. English mobile: the same master's save flow.
  const english = await newPage({
    viewport: { width: 390, height: 844 },
    language: 'en',
  })
  await english.page.getByLabel('Course name', { exact: true }).fill('Linear Algebra')
  await english.page.getByRole('button', { name: 'Add course' }).click()
  await english.page.getByText('Linear Algebra', { exact: true }).first().waitFor()
  const englishItems = await readItems(english.page)
  assert.ok(englishItems.some((item) => item.title === 'Linear Algebra'))
  await assertNoHorizontalOverflow(english.page)
  await english.page.screenshot({
    path: path.join(os.tmpdir(), 'education-course-save-en-mobile.png'),
    fullPage: true,
  })
  await english.context.close()

  assert.deepEqual(pageErrors, [], 'no runtime page errors')
  console.log(
    'Course save E2E passed: Persian/English master courses, reload persistence, edit/delete, university + training paths, double-click guard, malformed legacy data, fa/en mobile.'
  )
} catch (error) {
  console.error('Course save E2E failed:', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
