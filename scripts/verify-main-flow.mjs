import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })
const page = await context.newPage()
page.setDefaultTimeout(8000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

const money = (value) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value)

try {
  // 1. Task → persistent timer → refresh.
  await page.goto(`${baseUrl}/tasks`)
  const taskTitle = `Main flow task ${Date.now()}`
  await page.getByPlaceholder('عنوان تسک').fill(taskTitle)
  await page.locator('input[type="time"]').first().fill('09:00')
  await page.getByLabel('مدت به دقیقه').fill('30')
  await page.getByRole('button', { name: 'افزودن تسک' }).click()
  await page.getByText(taskTitle, { exact: true }).waitFor()

  await page.getByRole('button', { name: 'شروع یا ادامهٔ تایمر' }).click()
  await page.waitForTimeout(1200)
  await page.reload()
  await page.getByRole('button', { name: 'مکث تایمر' }).waitFor()
  const persistedClock = await page.getByText(/00:00:0[1-9]/).first().textContent()
  await page.getByRole('button', { name: 'مکث تایمر' }).click()

  // 2. Work report uses the saved task time.
  await page.getByRole('button', { name: 'کپی گزارش' }).click()
  await page.getByText('کپی شد', { exact: true }).waitFor()
  const report = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(report.includes(taskTitle), `report should mention the task: ${report}`)
  assert.ok(report.includes('گزارش کار'), `report should be a work report: ${report}`)

  // 3. The linked timer interval appears in the work log.
  await page.goto(`${baseUrl}/wordpress`)
  await page.getByText(taskTitle, { exact: true }).first().waitFor()
  assert.ok((await page.getByText('از تایمر', { exact: true }).count()) > 0, 'timer interval is linked to the task')

  // 4. Finance: salary, expense, saving, exact totals, persistence after reload.
  await page.goto(`${baseUrl}/finance`)
  await page.getByPlaceholder('مبلغ به تومان کامل').first().fill('10000000')
  await page.getByRole('button', { name: 'ثبت حقوق ماهانه' }).click()
  await page.getByText(`${money(10000000)} تومان`).first().waitFor()

  const entryForm = page.locator('form').filter({ has: page.getByPlaceholder('عنوان', { exact: true }) })
  await entryForm.getByPlaceholder('مبلغ به تومان کامل').fill('2000000')
  await entryForm.getByPlaceholder('عنوان', { exact: true }).fill('خرید هفتگی')
  await entryForm.locator('select').nth(1).selectOption('food')
  await entryForm.getByRole('button', { name: 'ذخیره', exact: true }).click()
  await page.getByText(`${money(2000000)} تومان`).first().waitFor()

  await entryForm.locator('select').first().selectOption('saving')
  await entryForm.getByPlaceholder('مبلغ به تومان کامل').fill('1000000')
  await entryForm.getByPlaceholder('عنوان', { exact: true }).fill('پس‌انداز ماه')
  await entryForm.locator('select').nth(1).selectOption('savings')
  await entryForm.getByRole('button', { name: 'ذخیره', exact: true }).click()
  await page.getByText(`${money(1000000)} تومان`).first().waitFor()

  await page.getByText(`${money(5000000)} تومان`).first().waitFor()
  await page.getByText(`${money(7000000)} تومان`).first().waitFor()
  await page.reload()
  await page.getByText(`${money(10000000)} تومان`).first().waitFor()
  await page.getByText(`${money(7000000)} تومان`).first().waitFor()

  assert.deepEqual(pageErrors, [], `browser reported uncaught errors: ${pageErrors.join(' | ')}`)
  console.log(JSON.stringify({
    ok: true,
    task: taskTitle,
    timerAfterReload: persistedClock?.trim(),
    report,
    finance: {
      income: 10000000,
      expenses: 2000000,
      actualSavings: 1000000,
      savingsGoal: 5000000,
      budgetBalance: 7000000,
      persistedAfterReload: true,
    },
  }, null, 2))
} finally {
  await browser.close()
}
