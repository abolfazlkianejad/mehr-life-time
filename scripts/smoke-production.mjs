import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(3000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('requestfailed', (request) => console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText))
page.on('console', (message) => { if (message.type() === 'error') console.log('BROWSER CONSOLE:', message.text()) })

try {
  await page.goto(`${baseUrl}/tasks`)
  const initialLanguage = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }))
  assert.deepEqual(initialLanguage, { lang: 'fa', dir: 'rtl' })

  const taskTitle = `Smoke tracked task ${Date.now()}`
  await page.getByPlaceholder('عنوان تسک').fill(taskTitle)
  await page.locator('input[type="time"]').first().fill('09:00')
  await page.getByRole('button', { name: 'افزودن تسک' }).click()
  await page.getByText(taskTitle, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'شروع یا ادامهٔ تایمر' }).click()
  await page.waitForTimeout(1200)
  await page.reload()
  await page.getByRole('button', { name: 'مکث تایمر' }).waitFor()
  await page.getByRole('button', { name: 'مکث تایمر' }).click()

  await page.goto(`${baseUrl}/wordpress`)
  console.log('WORK LOG PAGE:', page.url(), await page.title(), JSON.stringify(await page.locator('body').innerHTML()).slice(0, 5000), 'PAGE ERRORS:', pageErrors)
  await page.getByText(taskTitle, { exact: true }).waitFor()
  assert.ok(await page.getByText('از تایمر', { exact: true }).count(), 'timer interval is linked to its task')

  await page.getByRole('button', { name: 'تغییر زبان' }).click()
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr')
  await page.getByRole('button', { name: 'Switch language' }).click()
  await page.waitForFunction(() => document.documentElement.lang === 'fa' && document.documentElement.dir === 'rtl')

  await page.goto(baseUrl)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.reload()
  await page.getByText('داشبورد', { exact: true }).first().waitFor({ timeout: 10000 })
  assert.deepEqual(pageErrors, [], 'browser should not report uncaught application errors')

  console.log('PASS: timer survives reload, pause records a linked work interval, language toggles fa/RTL ↔ en/LTR, and the dashboard shell opens offline.')
} finally {
  await browser.close()
}
