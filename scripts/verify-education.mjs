import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

/**
 * End-to-end verification of the Education section.
 *
 * Runs against a fresh browser profile, so it never touches the database of the
 * developer's normal browser. Start the app first, for example:
 *
 *   npm run dev -- --port 5199
 *   node scripts/verify-education.mjs http://127.0.0.1:5199
 */
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1360, height: 960 } })
await context.addInitScript(() => window.localStorage.setItem('app-language', 'fa'))
const page = await context.newPage()
page.setDefaultTimeout(10_000)
page.on('dialog', (dialog) => dialog.accept())
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

const shot = (name) =>
  page.screenshot({
    path: path.join(os.tmpdir(), `education-${name}.png`),
    fullPage: true,
  })

const cardFor = (title) =>
  page
    .locator('div.rounded-lg.border.p-3')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()

try {
  await page.goto(`${baseUrl}/education`)
  await page.getByRole('heading', { name: 'آموزش', exact: true }).waitFor()

  // 1. Master's course with resources.
  await page.getByLabel('نام دوره').fill('آمار کاربردی')
  await page.getByLabel('منابع و کتاب‌ها').fill('کتاب آمار، جزوه استاد')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('آمار کاربردی', { exact: true }).first().waitFor()
  await page.getByText(/کتاب آمار، جزوه استاد/).waitFor()
  assert.ok(
    (await page.getByText('تاریخ ایجاد', { exact: false }).count()) >= 1,
    'course creation date is shown in Jalali'
  )
  await shot('desktop-masters')

  // 2. University course with credits, professor and semester.
  await page.getByRole('tab', { name: 'دروس دانشگاه' }).click()
  await page.getByLabel('نام دوره').fill('اقتصاد خرد')
  await page.getByLabel('تعداد واحد').fill('3')
  await page.getByLabel('استاد').fill('دکتر رضایی')
  await page.getByLabel('نیم‌سال').fill('نیم‌سال اول ۱۴۰۵')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('اقتصاد خرد', { exact: true }).first().waitFor()
  await page.getByText(/3 واحد/).waitFor()

  // 3. Training course with instructor, platform, hours, URL and progress.
  await page.getByRole('tab', { name: 'دوره‌های آموزشی' }).click()
  await page.getByLabel('نام دوره').fill('React پیشرفته')
  await page.getByLabel('مدرس').fill('علی محمدی')
  await page.getByLabel('پلتفرم').fill('یوتیوب')
  await page.getByLabel('ساعت برآوردی').fill('12.5')
  await page.getByLabel('پیشرفت (٪)').fill('35')
  await page.getByLabel('نشانی دوره').fill('https://example.com/react')
  await page.getByRole('button', { name: 'افزودن مورد' }).click()
  await page.getByText('React پیشرفته', { exact: true }).first().waitFor()
  await page.getByText('https://example.com/react').waitFor()

  // 3b. Edit the training course, then delete it (course CRUD).
  await cardFor('React پیشرفته').getByRole('button', { name: 'ویرایش مورد' }).click()
  await page.getByLabel('نام دوره').fill('React حرفه‌ای')
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات' }).click()
  await page.getByText('React حرفه‌ای', { exact: true }).first().waitFor()
  await cardFor('React حرفه‌ای').getByRole('button', { name: 'حذف مورد' }).click()
  await page.getByText('React حرفه‌ای', { exact: true }).waitFor({ state: 'detached' })

  // 4. Task with a real Jalali calendar date and a real 24-hour time.
  await page.getByRole('tab', { name: 'تسک‌های آموزشی' }).click()
  await page.getByLabel('عنوان تسک', { exact: true }).fill('حل تمرین اقتصاد')
  await page.getByLabel('مسیر آموزشی').selectOption('university')
  await page.getByLabel('دورهٔ مرتبط').selectOption({ label: 'اقتصاد خرد' })
  await page.getByLabel('اولویت').selectOption('urgent')
  await page.getByLabel('مدت برآوردی (دقیقه)').fill('45')

  const dateTrigger = page.getByRole('button', { name: 'تاریخ شمسی' }).first()
  const dateBefore = (await dateTrigger.textContent()).trim()
  await dateTrigger.click()
  const calendar = page.getByRole('dialog')
  await calendar.locator('button[aria-pressed="false"]').last().click()
  const dateAfter = (await dateTrigger.textContent()).trim()
  assert.notEqual(dateAfter, dateBefore, 'the Jalali picker must change the selected day')

  await page.getByRole('button', { name: 'ساعت (۲۴ ساعته)' }).click()
  await page.getByRole('option', { name: 'ساعت 14' }).click()
  await page.getByRole('option', { name: 'دقیقه 30' }).click()
  const timeTrigger = page.getByRole('button', { name: 'ساعت (۲۴ ساعته)' })
  assert.match((await timeTrigger.textContent()).trim(), /۱۴:۳۰/)
  assert.ok(
    (await page.getByRole('option', { name: /PM|AM/ }).count()) === 0,
    'the time picker must not expose AM/PM'
  )

  await page.getByRole('button', { name: 'افزودن تسک' }).click()
  await page.getByText('حل تمرین اقتصاد', { exact: true }).first().waitFor()
  assert.ok((await page.getByText('اقتصاد خرد', { exact: true }).count()) >= 1, 'task shows its course')
  await shot('desktop-task')

  // 5. A second task, then sort/search/filter.
  await page.getByLabel('عنوان تسک', { exact: true }).fill('مرور اقتصاد')
  await page.getByLabel('اولویت').selectOption('low')
  await page.getByRole('button', { name: 'افزودن تسک' }).click()
  await page.getByText('مرور اقتصاد', { exact: true }).first().waitFor()

  const yOf = async (text) =>
    (await page.getByText(text, { exact: true }).first().boundingBox()).y
  assert.ok(
    (await yOf('حل تمرین اقتصاد')) < (await yOf('مرور اقتصاد')),
    'default order puts the urgent task first'
  )
  await page.getByLabel('ترتیب نمایش').selectOption('time')
  assert.ok(
    (await yOf('مرور اقتصاد')) < (await yOf('حل تمرین اقتصاد')),
    'earlier 24-hour time sorts first'
  )
  await page.getByLabel('ترتیب نمایش').selectOption('priority')

  await page.getByLabel('جستجوی عنوان تسک').fill('مرور')
  await page.getByText('مرور اقتصاد', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('حل تمرین اقتصاد', { exact: true }).count(), 0)
  await page.getByLabel('جستجوی عنوان تسک').fill('')
  await page.getByLabel('فیلتر مسیر').selectOption('masters')
  await page.getByText('تسکی با این فیلترها پیدا نشد.').waitFor()
  await page.getByLabel('فیلتر مسیر').selectOption('all')

  // 6. Start, pause, resume. The banner and the card stay in sync.
  const firstCard = cardFor('حل تمرین اقتصاد')
  await firstCard.getByRole('button', { name: 'شروع' }).click()
  await page.getByText('در حال مطالعه', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'مکث' }).first().click()
  await firstCard.getByRole('button', { name: 'ادامه' }).waitFor()
  await firstCard.getByRole('button', { name: 'ادامه' }).click()
  await page.getByRole('button', { name: 'مکث' }).first().waitFor()

  // 7. Starting another task pauses the first one and keeps one timer only.
  await cardFor('مرور اقتصاد').getByRole('button', { name: 'شروع' }).click()
  await page.getByText('در حال اجرا', { exact: true }).waitFor()
  await firstCard.getByRole('button', { name: 'ادامه' }).waitFor()
  assert.equal(
    await page.getByText('در حال اجرا', { exact: true }).count(),
    1,
    'only one task may run'
  )
  await page.getByText('مرور اقتصاد', { exact: true }).first().scrollIntoViewIfNeeded()

  // 8. Refresh restores the running timer from its timestamp.
  await page.reload()
  await page.getByText('در حال مطالعه', { exact: true }).waitFor()
  await page.getByText('مرور اقتصاد', { exact: true }).first().waitFor()
  await page.waitForTimeout(1_200)
  assert.ok(
    (await page.getByRole('button', { name: 'مکث' }).count()) >= 1,
    'the timer resumes after a reload'
  )

  // 9. Two progress reports on the paused task, then edit one and delete one.
  await page.getByRole('tab', { name: 'تسک‌های آموزشی' }).click()
  await firstCard.getByRole('button', { name: 'گزارش پیشرفت 0' }).click()
  await firstCard.getByRole('button', { name: 'ثبت گزارش پیشرفت' }).click()
  await firstCard.getByLabel('چه چیزی مطالعه شد؟').fill('فصل اول مرور شد')
  await firstCard.getByLabel('مباحث تکمیل‌شده').fill('توزیع نرمال')
  await page.getByRole('button', { name: 'ثبت گزارش', exact: true }).click()
  await firstCard.getByText('فصل اول مرور شد', { exact: true }).waitFor()
  assert.match(
    (await firstCard.getByText(/۱۴۰۵\/[۰-۹]{2}\/[۰-۹]{2} · [۰-۹]{2}:[۰-۹]{2}/).first().textContent()).trim(),
    /۱۴۰۵\/[۰-۹]{2}\/[۰-۹]{2} · [۰-۹]{2}:[۰-۹]{2}/,
    'reports show a Jalali date and a 24-hour time'
  )

  await firstCard.getByRole('button', { name: 'ثبت گزارش پیشرفت' }).click()
  await firstCard.getByLabel('چه چیزی مطالعه شد؟').fill('مرور تمرین‌های فصل اول')
  await page.getByRole('button', { name: 'ثبت گزارش', exact: true }).click()
  await firstCard.getByRole('button', { name: 'گزارش پیشرفت 2' }).waitFor()

  // 10. The aggregated reports tab filters, edits and deletes real records.
  await page.getByRole('tab', { name: 'گزارش‌های مطالعه' }).click()
  await page.getByText('2 گزارش', { exact: true }).waitFor()
  const reportCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('فصل اول مرور شد', { exact: true }) })
    .last()
  await reportCard.getByRole('button', { name: 'ویرایش گزارش' }).click()
  await page.getByLabel('چه چیزی مطالعه شد؟').fill('فصل اول کامل مرور شد')
  await page.getByRole('button', { name: 'ذخیرهٔ تغییرات' }).click()
  await page.getByText('فصل اول کامل مرور شد', { exact: true }).waitFor()

  await page.getByLabel('جستجوی گزارش').fill('ناموجود')
  await page.getByText('0 گزارش', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'پاک کردن فیلترها' }).click()
  await page.getByText('2 گزارش', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'حذف گزارش' }).last().click()
  await page.getByText('1 گزارش', { exact: true }).waitFor()
  await shot('desktop-reports')

  // 11. Finish the running task; completed tasks move to their own section.
  await page.getByRole('button', { name: 'پایان' }).first().click()
  await page.getByRole('tab', { name: 'تسک‌های آموزشی' }).click()
  await page.getByLabel('فیلتر وضعیت').selectOption('all')
  await page.getByText('تسک‌های تکمیل‌شده', { exact: false }).first().waitFor()
  await page.getByLabel('فیلتر وضعیت').selectOption('completed')
  await page.getByText('مرور اقتصاد', { exact: true }).first().waitFor()

  // 12. Mobile layout in Persian, no horizontal page overflow.
  const mobile = await context.newPage()
  await mobile.setViewportSize({ width: 390, height: 844 })
  mobile.on('dialog', (dialog) => dialog.accept())
  await mobile.goto(`${baseUrl}/education`)
  await mobile.getByRole('heading', { name: 'آموزش', exact: true }).waitFor()
  await mobile.getByRole('tab', { name: 'تسک‌های آموزشی' }).click()
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    ),
    'the mobile page must not scroll horizontally'
  )
  await mobile.getByLabel('عنوان تسک', { exact: true }).fill('مرور موبایل')
  await mobile.getByLabel('مدت برآوردی (دقیقه)').fill('20')
  await mobile.getByLabel('اولویت').selectOption('high')
  await mobile.getByRole('button', { name: 'افزودن تسک' }).click()
  await mobile.getByText('مرور موبایل', { exact: true }).first().waitFor()
  await mobile.screenshot({
    path: path.join(os.tmpdir(), 'education-mobile-fa.png'),
    fullPage: true,
  })

  // 13. English layout (LTR) on mobile.
  await mobile.getByRole('button', { name: 'تغییر زبان' }).click()
  await mobile.getByRole('heading', { name: 'Education', exact: true }).waitFor()
  assert.ok(await mobile.getByText("Master's studies", { exact: true }).first().isVisible())
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    ),
    'the English mobile page must not scroll horizontally'
  )
  await mobile.getByRole('tab', { name: 'Study tasks' }).click()
  await mobile.screenshot({
    path: path.join(os.tmpdir(), 'education-mobile-en.png'),
    fullPage: true,
  })

  assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join(' | ')}`)
  console.log('Education E2E passed: courses, Jalali/24h task form, sorting, filters,')
  console.log('single timer, refresh restore, report history/edit/delete, fa-en mobile.')
  console.log('Screenshots:', os.tmpdir())
} finally {
  await browser.close()
}
