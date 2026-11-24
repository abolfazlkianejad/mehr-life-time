import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatJalaliDateKey } from '@/lib/jalali'
import {
  deleteFinanceEntry,
  getFinanceEntries,
  getFinanceSettings,
  saveFinanceEntry,
  saveFinanceSettings,
  type FinanceEntry,
} from '@/services/db'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { HeaderActions } from '@/components/header-actions'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { isAiConfigured, requestAiText } from '@/features/ai/client'
import {
  calculateFinanceTotals,
  categoryTotals,
  compareMonths,
  dailyFinanceRows,
  monthTrend,
  parseWholeToman,
  savingsGoalProgress,
} from '@/features/finance/finance-utils'

type EntryType = FinanceEntry['type']
type FormState = {
  id?: string
  type: EntryType
  amount: string
  date: string
  title: string
  category: string
  note: string
}
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const initialForm = (): FormState => ({
  type: 'expense',
  amount: '',
  date: today(),
  title: '',
  category: 'other',
  note: '',
})
const categories = [
  'salary',
  'freelance',
  'housing',
  'food',
  'transport',
  'health',
  'education',
  'savings',
  'other',
]

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function FinancePage() {
  const { t, i18n } = useTranslation()
  const [month, setMonth] = useState(today().slice(0, 7))
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [entries, setEntries] = useState<FinanceEntry[]>([])
  const [previousEntries, setPreviousEntries] = useState<FinanceEntry[]>([])
  const [trendEntries, setTrendEntries] = useState<
    Array<{ monthKey: string; entries: FinanceEntry[] }>
  >([])
  const [goalPercent, setGoalPercent] = useState('50')
  const [form, setForm] = useState<FormState>(initialForm)
  const [salary, setSalary] = useState('')
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analysing, setAnalysing] = useState(false)
  const locale = i18n.language === 'fa' ? 'fa-IR' : 'en-US'
  const displayMoney = (amount: bigint | number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} ${t('finance.toman')}`

  useEffect(() => {
    const months = Array.from({ length: 6 }, (_, index) =>
      shiftMonth(month, index - 5)
    )
    let active = true
    void (async () => {
      try {
        const [current, previous, trend, settings] = await Promise.all([
          getFinanceEntries(month),
          getFinanceEntries(shiftMonth(month, -1)),
          Promise.all(
            months.map(async (key) => ({
              monthKey: key,
              entries: await getFinanceEntries(key),
            }))
          ),
          getFinanceSettings(),
        ])
        if (!active) return
        setEntries(current)
        setPreviousEntries(previous)
        setTrendEntries(trend)
        setGoalPercent(String(settings.savingsGoalBasisPoints / 100))
      } catch {
        if (active) setError(t('finance.loadError'))
      }
    })()
    return () => {
      active = false
    }
  }, [month, t])

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) => categoryFilter === 'all' || entry.category === categoryFilter
      ),
    [entries, categoryFilter]
  )
  const totals = useMemo(
    () =>
      calculateFinanceTotals(
        entries,
        Math.round(Number(goalPercent || 0) * 100)
      ),
    [entries, goalPercent]
  )
  const previousTotals = useMemo(
    () =>
      calculateFinanceTotals(
        previousEntries,
        Math.round(Number(goalPercent || 0) * 100)
      ),
    [previousEntries, goalPercent]
  )
  const comparison = useMemo(
    () => compareMonths(totals, previousTotals),
    [totals, previousTotals]
  )
  const daily = useMemo(() => dailyFinanceRows(entries), [entries])
  const expenseCategories = useMemo(
    () => categoryTotals(entries, 'expense'),
    [entries]
  )
  const trend = useMemo(() => monthTrend(trendEntries), [trendEntries])

  const saveEntry = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const amount = parseWholeToman(form.amount)
    if (!amount) {
      setError(t('finance.invalidAmount'))
      return
    }
    try {
      const saved = await saveFinanceEntry({
        ...(form.id ? { id: form.id } : {}),
        type: form.type,
        amount,
        date: form.date,
        title: form.title,
        category: form.category,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      })
      setEntries((all) =>
        [saved, ...all.filter((entry) => entry.id !== saved.id)].sort((a, b) =>
          b.date.localeCompare(a.date)
        )
      )
      setForm(initialForm())
    } catch {
      setError(t('finance.saveError'))
    }
  }

  const recordSalary = async (event: FormEvent) => {
    event.preventDefault()
    const amount = parseWholeToman(salary)
    if (!amount) {
      setError(t('finance.invalidAmount'))
      return
    }
    try {
      const record = await saveFinanceEntry({
        type: 'income',
        amount,
        date: `${month}-01`,
        title: t('finance.monthlySalary'),
        category: 'salary',
      })
      setEntries((all) => [
        record,
        ...all.filter((entry) => entry.id !== record.id),
      ])
      setSalary('')
      setError('')
    } catch {
      setError(t('finance.saveError'))
    }
  }

  const saveGoal = async () => {
    const percent = Number(goalPercent)
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setError(t('finance.invalidGoal'))
      return
    }
    await saveFinanceSettings(percent * 100)
    setError('')
  }
  const edit = (entry: FinanceEntry) =>
    setForm({
      id: entry.id,
      type: entry.type,
      amount: String(entry.amount),
      date: entry.date,
      title: entry.title,
      category: entry.category,
      note: entry.note ?? '',
    })
  const remove = async (id: string) => {
    await deleteFinanceEntry(id)
    setEntries((all) => all.filter((entry) => entry.id !== id))
  }

  const runAnalysis = async () => {
    setError('')
    setAnalysis('')
    setAnalysing(true)
    const summaryLines = [
      `Month: ${month}`,
      `Income: ${totals.income}`,
      `Expenses: ${totals.expenses}`,
      `Recorded savings: ${totals.actualSavings}`,
      `Savings goal: ${totals.savingsGoal}`,
      `Budget balance: ${totals.budgetBalance}`,
      `Top expense categories: ${expenseCategories.map((row) => `${row.category}=${row.total}`).join(', ') || 'none'}`,
      `Previous month expenses: ${previousTotals.expenses}`,
    ].join('\n')

    const localInsights = [
      expenseCategories.length
        ? t('finance.analysis.topCategory', {
            category: t(`finance.categories.${expenseCategories[0]!.category}`),
            amount: displayMoney(expenseCategories[0]!.total),
          })
        : t('finance.analysis.noExpenses'),
      comparison.expenseTrend === 'up'
        ? t('finance.analysis.expenseUp')
        : comparison.expenseTrend === 'down'
          ? t('finance.analysis.expenseDown')
          : t('finance.analysis.expenseFlat'),
      t('finance.goalProgress', { percent: savingsGoalProgress(totals) }),
    ].join(' · ')

    if (!isAiConfigured()) {
      setAnalysis(localInsights)
      setAnalysing(false)
      return
    }
    try {
      const text = await requestAiText(
        [
          'Analyze this personal finance summary (toman).',
          summaryLines,
          'Give short, actionable observations. Do not suggest transactions and do not invent numbers.',
        ].join('\n'),
        {
          system:
            'You are a careful personal finance analyst. You never create or delete transactions.',
        }
      )
      setAnalysis(`${localInsights}\n\n${text}`)
    } catch {
      setAnalysis(`${localInsights}\n\n${t('finance.analysis.aiUnavailable')}`)
    } finally {
      setAnalysing(false)
    }
  }

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('finance.title')}</h2>
          <p className='text-muted-foreground'>{t('finance.subtitle')}</p>
        </div>
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
          {[
            ['income', totals.income],
            ['expenses', totals.expenses],
            ['actualSavings', totals.actualSavings],
            ['savingsGoal', totals.savingsGoal],
            ['budgetBalance', totals.budgetBalance],
          ].map(([key, value]) => (
            <Card key={String(key)}>
              <CardHeader className='pb-2'>
                <CardDescription>{t(`finance.${key}`)}</CardDescription>
              </CardHeader>
              <CardContent className='text-lg font-semibold tabular-nums'>
                {displayMoney(value as bigint)}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className='grid gap-4 xl:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Wallet className='size-5' />
                {t('finance.salaryTitle')}
              </CardTitle>
              <CardDescription>{t('finance.manualOnly')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className='flex flex-wrap gap-2'
                onSubmit={(event) => void recordSalary(event)}
              >
                <Input
                  inputMode='numeric'
                  value={salary}
                  onChange={(event) => setSalary(event.target.value)}
                  placeholder={t('finance.amount')}
                />
                <Button type='submit'>
                  <Plus className='me-2 size-4' />
                  {t('finance.addSalary')}
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('finance.savingsGoal')}</CardTitle>
              <CardDescription>{t('finance.goalDescription')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap gap-2'>
              <Input
                type='number'
                min='0'
                max='100'
                step='1'
                className='w-24'
                value={goalPercent}
                onChange={(event) => setGoalPercent(event.target.value)}
                aria-label={t('finance.goalPercent')}
              />
              <span className='self-center'>%</span>
              <Button variant='outline' onClick={() => void saveGoal()}>
                {t('finance.saveGoal')}
              </Button>
              <span className='self-center text-xs text-muted-foreground'>
                {t('finance.goalProgress', {
                  percent: savingsGoalProgress(totals),
                })}
              </span>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {form.id ? t('finance.editEntry') : t('finance.addEntry')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'
              onSubmit={(event) => void saveEntry(event)}
            >
              <select
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as EntryType })
                }
              >
                <option value='income'>{t('finance.income')}</option>
                <option value='expense'>{t('finance.expense')}</option>
                <option value='saving'>{t('finance.saving')}</option>
              </select>
              <Input
                inputMode='numeric'
                value={form.amount}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value })
                }
                placeholder={t('finance.amount')}
                required
              />
              <JalaliDatePicker
                value={form.date}
                onChange={(dateKey) => setForm({ ...form, date: dateKey })}
                ariaLabel={t('finance.entryDate')}
              />
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder={t('finance.entryTitle')}
                required
              />
              <select
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                {categories.map((key) => (
                  <option key={key} value={key}>
                    {t(`finance.categories.${key}`)}
                  </option>
                ))}
              </select>
              <Input
                value={form.note}
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
                placeholder={t('finance.noteOptional')}
              />
              <div className='flex gap-2'>
                <Button type='submit'>
                  {form.id ? t('finance.update') : t('finance.save')}
                </Button>
                {form.id && (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => setForm(initialForm())}
                  >
                    {t('finance.cancel')}
                  </Button>
                )}
              </div>
            </form>
            {error && (
              <p role='alert' className='mt-3 text-sm text-destructive'>
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        <div className='grid gap-4 xl:grid-cols-3'>
          <Card className='xl:col-span-2'>
            <CardHeader>
              <CardTitle>{t('finance.dailyReport')}</CardTitle>
              <CardDescription>{t('finance.dailyReportHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {daily.length ? (
                <div className='overflow-x-auto'>
                  <table className='w-full min-w-[520px] text-sm'>
                    <thead>
                      <tr className='border-b text-muted-foreground'>
                        <th className='py-2 text-start'>{t('finance.date')}</th>
                        <th className='text-start'>{t('finance.income')}</th>
                        <th className='text-start'>{t('finance.expenses')}</th>
                        <th className='text-start'>{t('finance.saving')}</th>
                        <th className='text-start'>{t('finance.balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row) => (
                        <tr
                          key={row.dateKey}
                          className='border-b last:border-0'
                        >
                          <td className='py-2'>
                            {formatJalaliDateKey(row.dateKey)}
                          </td>
                          <td className='py-2 tabular-nums'>
                            {displayMoney(row.income)}
                          </td>
                          <td className='py-2 tabular-nums'>
                            {displayMoney(row.expenses)}
                          </td>
                          <td className='py-2 tabular-nums'>
                            {displayMoney(row.savings)}
                          </td>
                          <td className='py-2 tabular-nums'>
                            {displayMoney(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('finance.empty')}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('finance.categoryReport')}</CardTitle>
              <CardDescription>
                {t('finance.categoryReportHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {expenseCategories.length ? (
                expenseCategories.map((row) => (
                  <div
                    key={row.category}
                    className='flex items-center justify-between gap-2 text-sm'
                  >
                    <span>
                      {t(`finance.categories.${row.category}`)}{' '}
                      <span className='text-xs text-muted-foreground'>
                        ({row.count})
                      </span>
                    </span>
                    <span className='font-semibold tabular-nums'>
                      {displayMoney(row.total)}
                    </span>
                  </div>
                ))
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('finance.empty')}
                </p>
              )}
              <div className='mt-3 border-t pt-3 text-sm'>
                <p className='font-medium'>{t('finance.monthComparison')}</p>
                <p className='text-muted-foreground'>
                  {t('finance.income')}: {displayMoney(totals.income)} (
                  {comparison.incomeDelta >= 0n ? '+' : ''}
                  {displayMoney(comparison.incomeDelta)})
                </p>
                <p className='text-muted-foreground'>
                  {t('finance.expenses')}: {displayMoney(totals.expenses)} (
                  {comparison.expenseDelta >= 0n ? '+' : ''}
                  {displayMoney(comparison.expenseDelta)})
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('finance.trendTitle')}</CardTitle>
            <CardDescription>{t('finance.trendHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[480px] text-sm'>
                  <thead>
                    <tr className='border-b text-muted-foreground'>
                      <th className='py-2 text-start'>{t('finance.month')}</th>
                      <th className='text-start'>{t('finance.income')}</th>
                      <th className='text-start'>{t('finance.expenses')}</th>
                      <th className='text-start'>{t('finance.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row) => (
                      <tr key={row.monthKey} className='border-b last:border-0'>
                        <td className='py-2'>
                          {formatJalaliDateKey(`${row.monthKey}-01`)}
                        </td>
                        <td className='py-2 tabular-nums'>
                          {displayMoney(row.income)}
                        </td>
                        <td className='py-2 tabular-nums'>
                          {displayMoney(row.expenses)}
                        </td>
                        <td className='py-2 tabular-nums'>
                          {displayMoney(row.income - row.expenses)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('finance.empty')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Sparkles className='size-5' />
              {t('finance.analysisTitle')}
            </CardTitle>
            <CardDescription>{t('finance.analysisHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Button
              variant='outline'
              disabled={analysing}
              onClick={() => void runAnalysis()}
            >
              {analysing ? (
                <LoaderCircle className='me-2 size-4 animate-spin' />
              ) : (
                <Sparkles className='me-2 size-4' />
              )}
              {t('finance.runAnalysis')}
            </Button>
            {analysis && (
              <p className='rounded-md border p-3 text-sm whitespace-pre-wrap'>
                {analysis}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('finance.records')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap gap-2'>
              <Input
                className='w-auto'
                type='month'
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
              <select
                aria-label={t('finance.categoryFilter')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value='all'>{t('finance.allCategories')}</option>
                {categories.map((key) => (
                  <option key={key} value={key}>
                    {t(`finance.categories.${key}`)}
                  </option>
                ))}
              </select>
            </div>
            {filtered.length ? (
              filtered.map((entry) => (
                <div
                  key={entry.id}
                  className='flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm'
                >
                  <div>
                    <p className='font-medium'>
                      {entry.title}{' '}
                      <Badge
                        variant={
                          entry.type === 'income' ? 'secondary' : 'outline'
                        }
                      >
                        {t(`finance.${entry.type}`)}
                      </Badge>
                    </p>
                    <p className='text-muted-foreground'>
                      {formatJalaliDateKey(entry.date)} ·{' '}
                      {t(`finance.categories.${entry.category}`)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <span className='font-semibold tabular-nums'>
                      {entry.type === 'expense'
                        ? '−'
                        : entry.type === 'saving'
                          ? '↗'
                          : '+'}
                      {displayMoney(BigInt(entry.amount))}
                    </span>
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('finance.editEntry')}
                      onClick={() => edit(entry)}
                    >
                      <Pencil className='size-4' />
                    </Button>
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('finance.deleteEntry')}
                      onClick={() => void remove(entry.id)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('finance.empty')}
              </p>
            )}
          </CardContent>
        </Card>
        <p className='text-xs text-muted-foreground'>
          {t('finance.disclaimer')}
        </p>
      </Main>
    </>
  )
}
