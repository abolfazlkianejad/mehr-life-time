import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(5000)
const pageErrors = []
let offline = false
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('requestfailed', (request) => {
  // Navigating between routes aborts in-flight lazy chunks; that is expected.
  if (request.failure()?.errorText === 'net::ERR_ABORTED') return
  if (!offline) console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText)
})
page.on('console', (message) => { if (message.type() === 'error') console.log('BROWSER CONSOLE:', message.text()) })

try {
  // Projects and tasks share one page; tasks are the second tab.
  await page.goto(`${baseUrl}/projects`)
  const initialLanguage = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }))
  assert.deepEqual(initialLanguage, { lang: 'fa', dir: 'rtl' })

  const taskTitle = `Smoke tracked task ${Date.now()}`
  await page.getByRole('tab', { name: 'تسک‌ها' }).click()
  await page.getByPlaceholder('عنوان تسک', { exact: true }).fill(taskTitle)
  await page.getByRole('button', { name: 'افزودن تسک' }).click()
  await page.getByText(taskTitle, { exact: true }).first().waitFor()

  // Timer keeps running across a reload and pauses into the same task.
  await page.getByRole('button', { name: 'شروع یا ادامهٔ تایمر' }).click()
  await page.waitForTimeout(1200)
  await page.reload()
  await page.getByRole('tab', { name: 'تسک‌ها' }).click()
  await page.getByRole('button', { name: 'مکث تایمر' }).waitFor()
  await page.getByRole('button', { name: 'مکث تایمر' }).click()
  await page.getByText(taskTitle, { exact: true }).first().waitFor()
  assert.match(
    await page.locator('main').innerText(),
    /00:00:0[1-9]/,
    'paused task keeps the elapsed time from before the reload'
  )

  // The old /tasks route now redirects to the unified page.
  await page.goto(`${baseUrl}/tasks`)
  await page.waitForURL(`${baseUrl}/projects`)

  // The elastic scheduler moves a paused, overdue task into a future slot.
  // Follow the dashboard picker to the day the task is actually stored on;
  // assuming "today" made this check depend on the wall-clock hour.
  const taskDayKey = await page.evaluate(async (title) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mehr-life-os')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const request = database.transaction('timelineBlocks', 'readonly')
        .objectStore('timelineBlocks').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return rows.find((row) => row.title === title)?.dateKey ?? null
  }, taskTitle)
  assert.ok(taskDayKey, 'the tracked task is persisted with a valid day key')

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  await page.goto(baseUrl)
  await page.getByText('داشبورد', { exact: true }).first().waitFor()
  if (taskDayKey !== todayKey) {
    const parts = await page.evaluate((key) => {
      const [year, month, day] = key.split('-').map(Number)
      const formatted = Object.fromEntries(
        new Intl.DateTimeFormat('en-u-ca-persian', {
          timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
        })
          .formatToParts(new Date(Date.UTC(year, month - 1, day)))
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, Number(part.value)])
      )
      return { year: formatted.year, month: formatted.month, day: formatted.day }
    }, taskDayKey)
    const toPersian = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])
    const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
    const dayLabel = `${toPersian(parts.day)} ${months[parts.month - 1]} ${toPersian(parts.year)}`
    await page.getByRole('button', { name: 'تاریخ انتخاب\u200cشده', exact: true }).click()
    await page.locator('[data-slot="popover-content"]').waitFor({ state: 'visible' })
    await page.getByLabel('سال', { exact: true }).selectOption(String(parts.year))
    await page.getByLabel('ماه', { exact: true }).selectOption(String(parts.month))
    await page.getByRole('button', { name: dayLabel, exact: true }).click({ force: true })
    await page.locator('[data-slot="popover-content"]').waitFor({ state: 'hidden' })
  }
  await page.getByText(taskTitle, { exact: true }).first().waitFor()
  assert.ok((await page.getByText('زمان واقعی', { exact: false }).count()) > 0, 'dashboard shows real task time')

  // Goals and analytics render from the same stored activity.
  await page.goto(`${baseUrl}/goals`)
  await page.getByText('کار و آموزش', { exact: true }).first().waitFor()
  await page.goto(`${baseUrl}/analytics`)
  await page.getByText('مرکز تحلیل', { exact: true }).first().waitFor()
  // Charts mount after the stored activity finishes loading.
  await page.locator('main svg.recharts-surface').first().waitFor({ timeout: 15000 })
  assert.ok(
    (await page.locator('main svg.recharts-surface').count()) > 0,
    'analytics renders real charts'
  )

  // Language toggle flips the document direction both ways.
  await page.getByRole('button', { name: 'تغییر زبان' }).click()
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr')
  await page.getByRole('button', { name: 'Switch language' }).click()
  await page.waitForFunction(() => document.documentElement.lang === 'fa' && document.documentElement.dir === 'rtl')

  // The production build installs a service worker and opens offline.
  await page.goto(baseUrl)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  offline = true
  await context.setOffline(true)
  await page.reload()
  await page.getByText('داشبورد', { exact: true }).first().waitFor({ timeout: 10000 })
  assert.deepEqual(pageErrors, [], 'browser should not report uncaught application errors')

  console.log('PASS: task timer survives reload, /tasks redirects to /projects, dashboard shows real time, goals and analytics render, language toggles fa/RTL ↔ en/LTR, and the dashboard shell opens offline.')
} finally {
  await browser.close()
}
