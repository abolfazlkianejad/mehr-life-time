import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  GraduationCap,
  TrendingUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey, formatJalaliLong } from '@/lib/jalali'
import {
  combinedByDay,
  loadActivityRange,
  type ActivityRange,
} from '@/services/activity'
import {
  getDashboardDaysByRange,
  getEnergyLogsByRange,
  getFinanceEntriesByRange,
  getMealLogsByRange,
  LEARNING_TRACKS,
  type LearningTrack,
} from '@/services/db'
import { findGoal, getGoals, type GoalRecord } from '@/services/goals'
import { getEducationItems, type EducationItem } from '@/services/learning'
import { getCardioLogsByRange } from '@/services/nutrition'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { HeaderActions } from '@/components/header-actions'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { formatHoursMinutes, weekdayLabel } from '@/features/goals/goal-utils'
import {
  RANGE_PRESETS,
  averageDefined,
  cumulativeSeries,
  deltaPercent,
  isValidRange,
  presetRange,
  previousRange,
  sharePercent,
  shortJalaliLabel,
  sleepMinutesBetween,
  sumValues,
  weekdayAverages,
  type RangeBounds,
  type RangePreset,
} from './analytics-utils'

const COLORS = {
  primary: '#6366f1',
  work: '#6366f1',
  education: '#8b5cf6',
  target: '#f59e0b',
  gym: '#10b981',
  sleep: '#0ea5e9',
  intake: '#f97316',
  burned: '#ef4444',
  income: '#10b981',
  expense: '#f43f5e',
  energy: '#eab308',
}

interface RangeMetrics {
  activity: ActivityRange
  sleepByDay: Record<string, number>
  intakeByDay: Record<string, number>
  burnedByDay: Record<string, number>
  incomeByDay: Record<string, number>
  expenseByDay: Record<string, number>
  energyByDay: Record<string, number | null>
}

function hoursOf(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

async function loadMetrics(from: string, to: string): Promise<RangeMetrics> {
  const [activity, dayRecords, meals, cardio, finance, energy] =
    await Promise.all([
      loadActivityRange(from, to),
      getDashboardDaysByRange(from, to),
      getMealLogsByRange(from, to),
      getCardioLogsByRange(from, to),
      getFinanceEntriesByRange(from, to),
      getEnergyLogsByRange(from, to),
    ])

  const sleepByDay: Record<string, number> = {}
  for (const record of dayRecords) {
    const minutes = sleepMinutesBetween(record.sleepTime ?? '', record.wakeTime)
    if (minutes !== null) sleepByDay[record.dateKey] = minutes
  }

  const intakeByDay: Record<string, number> = {}
  for (const meal of meals) {
    intakeByDay[meal.dateKey] = (intakeByDay[meal.dateKey] ?? 0) + meal.calories
  }

  const burnedByDay: Record<string, number> = {}
  for (const entry of cardio) {
    burnedByDay[entry.dateKey] =
      (burnedByDay[entry.dateKey] ?? 0) + entry.calories
  }

  const incomeByDay: Record<string, number> = {}
  const expenseByDay: Record<string, number> = {}
  for (const entry of finance) {
    const bucket =
      entry.type === 'income'
        ? incomeByDay
        : entry.type === 'expense'
          ? expenseByDay
          : null
    if (!bucket) continue
    bucket[entry.date] = (bucket[entry.date] ?? 0) + entry.amount
  }

  const energyByDay: Record<string, number | null> = {}
  const energySums = new Map<string, { total: number; count: number }>()
  for (const log of energy) {
    const current = energySums.get(log.dateKey) ?? { total: 0, count: 0 }
    current.total += log.score
    current.count += 1
    energySums.set(log.dateKey, current)
  }
  for (const [day, entry] of energySums) {
    energyByDay[day] = entry.count ? entry.total / entry.count : null
  }

  return {
    activity,
    sleepByDay,
    intakeByDay,
    burnedByDay,
    incomeByDay,
    expenseByDay,
    energyByDay,
  }
}

interface CompareRow {
  key: string
  label: string
  current: number
  previous: number
  format: (value: number) => string
}

const chartTooltipLabel = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatJalaliDateKey(value)
    : String(value ?? '')

export function AnalyticsPage() {
  const { t, i18n } = useTranslation()
  const today = toDateKey(new Date())

  const [preset, setPreset] = useState<RangePreset>('week')
  const [range, setRange] = useState<RangeBounds>(() =>
    presetRange('week', today)
  )
  const [customFrom, setCustomFrom] = useState(range.from)
  const [customTo, setCustomTo] = useState(range.to)
  const [metrics, setMetrics] = useState<RangeMetrics | null>(null)
  const [previous, setPrevious] = useState<RangeMetrics | null>(null)
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [items, setItems] = useState<EducationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rangeError, setRangeError] = useState('')
  const [trendMetric, setTrendMetric] = useState<
    'combined' | 'work' | 'education'
  >('combined')
  const [trackFilter, setTrackFilter] = useState<'all' | LearningTrack>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [current, savedGoals, educationItems] = await Promise.all([
        loadMetrics(range.from, range.to),
        getGoals(),
        getEducationItems(),
      ])
      setMetrics(current)
      setGoals(savedGoals)
      setItems(educationItems)
      const previousBounds = previousRange(range.from, range.to, preset, today)
      if (previousBounds) {
        setPrevious(await loadMetrics(previousBounds.from, previousBounds.to))
      } else {
        setPrevious(null)
      }
    } catch {
      setError(t('analytics.loadError'))
    } finally {
      setLoading(false)
    }
  }, [preset, range.from, range.to, t, today])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on the selected range
  }, [range.from, range.to, preset])

  const choosePreset = (next: RangePreset) => {
    setRangeError('')
    setPreset(next)
    if (next === 'custom') return
    const bounds = presetRange(next, today)
    setRange(bounds)
    setCustomFrom(bounds.from)
    setCustomTo(bounds.to)
  }

  const applyCustom = () => {
    if (!isValidRange(customFrom, customTo)) {
      setRangeError(t('analytics.invalidRange'))
      return
    }
    setRangeError('')
    setPreset('custom')
    setRange({ from: customFrom, to: customTo })
  }

  const days = useMemo(() => metrics?.activity.days ?? [], [metrics])
  const combinedMap = useMemo(
    () => (metrics ? combinedByDay(metrics.activity) : {}),
    [metrics]
  )
  const selectedMap = useMemo(() => {
    if (!metrics) return {}
    if (trendMetric === 'work') return metrics.activity.workByDay
    if (trendMetric === 'education') return metrics.activity.educationByDay
    return combinedMap
  }, [metrics, trendMetric, combinedMap])

  const dailyTarget =
    findGoal(goals, 'work_education', 'daily')?.target ??
    (findGoal(goals, 'work_education', 'weekly')?.target ?? 0) / 7

  const targetSeries = days.map((day) => ({
    day,
    actual: hoursOf(combinedMap[day] ?? 0),
    ...(dailyTarget > 0 ? { target: hoursOf(dailyTarget) } : {}),
  }))

  const trendSeries = days.map((day) => ({
    day,
    hours: hoursOf(selectedMap[day] ?? 0),
  }))
  const cumulative = cumulativeSeries(selectedMap, days)
  const cumulativeData = days.map((day, index) => ({
    day,
    hours: hoursOf(cumulative[index] ?? 0),
  }))
  const weekdayData = weekdayAverages(combinedMap, days).map((entry) => ({
    weekday: entry.weekday,
    label: weekdayLabel(
      `2024-01-${String(6 + entry.weekday).padStart(2, '0')}`,
      i18n.language
    ),
    hours: hoursOf(entry.average),
  }))

  const gymData = days
    .filter((day) => (metrics?.activity.gymByDay[day] ?? 0) > 0)
    .map((day) => ({ day, sessions: metrics?.activity.gymByDay[day] ?? 0 }))

  const sleepData = days
    .filter((day) => metrics?.sleepByDay[day] !== undefined)
    .map((day) => ({
      day,
      hours: Math.round(((metrics?.sleepByDay[day] ?? 0) / 60) * 100) / 100,
    }))

  const nutritionData = days
    .filter(
      (day) =>
        (metrics?.intakeByDay[day] ?? 0) > 0 ||
        (metrics?.burnedByDay[day] ?? 0) > 0
    )
    .map((day) => ({
      day,
      intake: metrics?.intakeByDay[day] ?? 0,
      burned: metrics?.burnedByDay[day] ?? 0,
    }))

  const financeData = days
    .filter(
      (day) =>
        (metrics?.incomeByDay[day] ?? 0) > 0 ||
        (metrics?.expenseByDay[day] ?? 0) > 0
    )
    .map((day) => ({
      day,
      income: metrics?.incomeByDay[day] ?? 0,
      expense: metrics?.expenseByDay[day] ?? 0,
    }))

  const energyData = days
    .filter(
      (day) =>
        metrics?.energyByDay[day] !== null &&
        metrics?.energyByDay[day] !== undefined
    )
    .map((day) => ({ day, score: metrics?.energyByDay[day] ?? 0 }))

  const totals = useMemo(() => {
    if (!metrics) {
      return {
        work: 0,
        education: 0,
        combined: 0,
        gym: 0,
        sleep: null as number | null,
        intake: 0,
        burned: 0,
        income: 0,
        expense: 0,
        energy: null as number | null,
      }
    }
    return {
      work: metrics.activity.workSeconds,
      education: metrics.activity.educationSeconds,
      combined:
        metrics.activity.workSeconds + metrics.activity.educationSeconds,
      gym: metrics.activity.gymCompleted,
      sleep: averageDefined(metrics.sleepByDay, days),
      intake: sumValues(metrics.intakeByDay, days),
      burned: sumValues(metrics.burnedByDay, days),
      income: sumValues(metrics.incomeByDay, days),
      expense: sumValues(metrics.expenseByDay, days),
      energy: averageDefined(metrics.energyByDay, days),
    }
  }, [metrics, days])

  const previousTotals = useMemo(() => {
    if (!previous) return null
    const prevDays = previous.activity.days
    return {
      work: previous.activity.workSeconds,
      education: previous.activity.educationSeconds,
      combined:
        previous.activity.workSeconds + previous.activity.educationSeconds,
      gym: previous.activity.gymCompleted,
      sleep: averageDefined(previous.sleepByDay, prevDays),
      intake: sumValues(previous.intakeByDay, prevDays),
      burned: sumValues(previous.burnedByDay, prevDays),
      income: sumValues(previous.incomeByDay, prevDays),
      expense: sumValues(previous.expenseByDay, prevDays),
      energy: averageDefined(previous.energyByDay, prevDays),
    }
  }, [previous])

  const compareRows: CompareRow[] = previousTotals
    ? [
        {
          key: 'combined',
          label: t('analytics.metrics.combined'),
          current: totals.combined,
          previous: previousTotals.combined,
          format: (value) => `${formatHoursMinutes(value)} h`,
        },
        {
          key: 'gym',
          label: t('analytics.metrics.gym'),
          current: totals.gym,
          previous: previousTotals.gym,
          format: (value) => `${Math.round(value)}`,
        },
        {
          key: 'sleep',
          label: t('analytics.metrics.sleep'),
          current: totals.sleep ?? 0,
          previous: previousTotals.sleep ?? 0,
          format: (value) => formatHoursMinutes(value * 60),
        },
        {
          key: 'nutrition',
          label: t('analytics.metrics.nutrition'),
          current: totals.intake,
          previous: previousTotals.intake,
          format: (value) => `${Math.round(value)} kcal`,
        },
        {
          key: 'finance',
          label: t('analytics.metrics.finance'),
          current: totals.income - totals.expense,
          previous: previousTotals.income - previousTotals.expense,
          format: (value) =>
            `${new Intl.NumberFormat('en-US').format(Math.round(value))} ${t('analytics.toman')}`,
        },
        {
          key: 'energy',
          label: t('analytics.metrics.energy'),
          current: totals.energy ?? 0,
          previous: previousTotals.energy ?? 0,
          format: (value) => `${Math.round(value * 10) / 10}`,
        },
      ]
    : []

  const compareChart = previousTotals
    ? [
        {
          name: t('analytics.metrics.work'),
          current: hoursOf(totals.work),
          previous: hoursOf(previousTotals.work),
        },
        {
          name: t('analytics.metrics.education'),
          current: hoursOf(totals.education),
          previous: hoursOf(previousTotals.education),
        },
        {
          name: t('analytics.metrics.combined'),
          current: hoursOf(totals.combined),
          previous: hoursOf(previousTotals.combined),
        },
      ]
    : []

  const trackTotals = metrics?.activity.educationByTrack
  const courseTrack = useMemo(() => {
    const map = new Map<string, LearningTrack>()
    for (const task of metrics?.activity.educationTasks ?? []) {
      if (task.courseId) map.set(task.courseId, task.track)
    }
    return map
  }, [metrics])

  const courseRows = useMemo(() => {
    if (!metrics) return []
    const total = metrics.activity.educationSeconds
    return Object.entries(metrics.activity.educationByCourse)
      .filter(
        ([courseId]) =>
          trackFilter === 'all' || courseTrack.get(courseId) === trackFilter
      )
      .map(([courseId, seconds]) => ({
        courseId,
        title: items.find((item) => item.id === courseId)?.title ?? courseId,
        seconds,
        share: sharePercent(seconds, total),
      }))
      .sort((a, b) => b.seconds - a.seconds)
  }, [metrics, items, trackFilter, courseTrack])

  const educationChart = LEARNING_TRACKS.filter(
    (track) => trackFilter === 'all' || track === trackFilter
  ).map((track) => ({
    name: t(`learning.tracks.${track}`),
    hours: hoursOf(trackTotals?.[track] ?? 0),
  }))

  const noData =
    metrics !== null &&
    totals.work === 0 &&
    totals.education === 0 &&
    totals.gym === 0 &&
    totals.intake === 0 &&
    totals.burned === 0 &&
    totals.income === 0 &&
    totals.expense === 0 &&
    totals.sleep === null &&
    totals.energy === null

  const emptyText = t('analytics.emptyMetric')

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            {t('analytics.title')}
          </h2>
          <p className='text-muted-foreground'>{t('analytics.subtitle')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <CalendarRange className='size-5' />
              {t('analytics.activeRange')}
            </CardTitle>
            <CardDescription>
              {formatJalaliLong(range.from)} — {formatJalaliLong(range.to)}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap gap-2'>
              {RANGE_PRESETS.map((option) => (
                <Button
                  key={option}
                  size='sm'
                  variant={preset === option ? 'secondary' : 'outline'}
                  onClick={() => choosePreset(option)}
                >
                  {t(`analytics.range.${option}`)}
                </Button>
              ))}
            </div>
            {preset === 'custom' ? (
              <div className='flex flex-wrap items-end gap-2'>
                <label className='space-y-1 text-sm'>
                  <span className='text-muted-foreground'>
                    {t('analytics.rangeFrom')}
                  </span>
                  <JalaliDatePicker
                    value={customFrom}
                    onChange={setCustomFrom}
                    ariaLabel={t('analytics.rangeFrom')}
                  />
                </label>
                <label className='space-y-1 text-sm'>
                  <span className='text-muted-foreground'>
                    {t('analytics.rangeTo')}
                  </span>
                  <JalaliDatePicker
                    value={customTo}
                    onChange={setCustomTo}
                    ariaLabel={t('analytics.rangeTo')}
                  />
                </label>
                <Button onClick={applyCustom}>{t('analytics.apply')}</Button>
              </div>
            ) : null}
            {rangeError ? (
              <p role='alert' className='text-sm text-destructive'>
                {rangeError}
              </p>
            ) : null}
            {error ? (
              <p
                role='alert'
                className='flex items-center gap-2 text-sm text-destructive'
              >
                <AlertTriangle className='size-4' />
                {error}
              </p>
            ) : null}
            {noData ? (
              <p className='flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground'>
                <AlertTriangle className='size-4' />
                {t('analytics.noData')}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('analytics.loading')}
          </p>
        ) : null}

        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <MetricCard
            title={t('analytics.metrics.combined')}
            value={`${formatHoursMinutes(totals.combined)} h`}
            hint={t('analytics.total')}
          />
          <MetricCard
            title={t('analytics.metrics.work')}
            value={`${formatHoursMinutes(totals.work)} h`}
            hint={t('analytics.total')}
          />
          <MetricCard
            title={t('analytics.metrics.education')}
            value={`${formatHoursMinutes(totals.education)} h`}
            hint={t('analytics.total')}
          />
          <MetricCard
            title={t('analytics.metrics.gym')}
            value={`${totals.gym}`}
            hint={t('analytics.sessions')}
          />
          <MetricCard
            title={t('analytics.metrics.sleep')}
            value={
              totals.sleep === null
                ? '—'
                : formatHoursMinutes(totals.sleep * 60)
            }
            hint={t('analytics.average')}
          />
          <MetricCard
            title={t('analytics.metrics.nutrition')}
            value={`${Math.round(totals.intake - totals.burned)} kcal`}
            hint={`${t('analytics.labels.intake')} − ${t('analytics.labels.burned')}`}
          />
          <MetricCard
            title={t('analytics.metrics.finance')}
            value={`${new Intl.NumberFormat('en-US').format(totals.income - totals.expense)} ${t('analytics.toman')}`}
            hint={`${t('analytics.labels.income')} − ${t('analytics.labels.expenses')}`}
          />
          <MetricCard
            title={t('analytics.metrics.energy')}
            value={
              totals.energy === null
                ? '—'
                : `${Math.round(totals.energy * 10) / 10}`
            }
            hint={t('analytics.average')}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <TrendingUp className='size-5' />
              {t('analytics.compare.title')}
            </CardTitle>
            <CardDescription>{t('analytics.compare.hint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {previousTotals ? (
              <>
                <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                  {compareRows.map((row) => {
                    const delta = deltaPercent(row.current, row.previous)
                    return (
                      <div
                        key={row.key}
                        className='rounded-lg border p-3 text-sm'
                      >
                        <p className='text-muted-foreground'>{row.label}</p>
                        <div className='mt-1 flex items-baseline justify-between gap-2'>
                          <span className='font-semibold tabular-nums'>
                            {row.format(row.current)}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {t('analytics.compare.previous')}:{' '}
                            {row.format(row.previous)}
                          </span>
                        </div>
                        <p
                          className={`mt-1 text-xs tabular-nums ${
                            delta === null
                              ? 'text-muted-foreground'
                              : delta >= 0
                                ? 'text-emerald-600'
                                : 'text-destructive'
                          }`}
                        >
                          {delta === null
                            ? t('analytics.compare.notComparable')
                            : `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`}
                        </p>
                      </div>
                    )
                  })}
                </div>
                <div className='h-64 w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart
                      data={compareChart}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray='3 3'
                        className='stroke-muted'
                      />
                      <XAxis dataKey='name' tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} width={40} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey='current'
                        name={t('analytics.compare.current')}
                        fill={COLORS.primary}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey='previous'
                        name={t('analytics.compare.previous')}
                        fill={COLORS.target}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('analytics.compare.noPrevious')}
              </p>
            )}
          </CardContent>
        </Card>

        <div className='grid gap-4 xl:grid-cols-2'>
          <ChartCard
            title={t('analytics.charts.targetVsActual')}
            hint={t('analytics.charts.targetVsActualHint')}
            empty={!days.length}
            emptyText={emptyText}
          >
            <ComposedChart
              data={targetSeries}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Legend />
              <Bar
                dataKey='actual'
                name={t('analytics.labels.actual')}
                fill={COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
              {dailyTarget > 0 ? (
                <Line
                  type='monotone'
                  dataKey='target'
                  name={t('analytics.labels.target')}
                  stroke={COLORS.target}
                  strokeWidth={2}
                  dot={false}
                />
              ) : null}
            </ComposedChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.trend')}
            hint={t('analytics.charts.trendHint')}
            empty={!days.length}
            emptyText={emptyText}
            action={
              <select
                aria-label={t('analytics.metrics.title')}
                className='h-8 rounded-md border bg-background px-2 text-xs'
                value={trendMetric}
                onChange={(event) =>
                  setTrendMetric(
                    event.target.value as 'combined' | 'work' | 'education'
                  )
                }
              >
                <option value='combined'>
                  {t('analytics.metrics.combined')}
                </option>
                <option value='work'>{t('analytics.metrics.work')}</option>
                <option value='education'>
                  {t('analytics.metrics.education')}
                </option>
              </select>
            }
          >
            <LineChart
              data={trendSeries}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Line
                type='monotone'
                dataKey='hours'
                name={t('analytics.hoursUnit')}
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.cumulative')}
            hint={t('analytics.charts.cumulativeHint')}
            empty={!days.length}
            emptyText={emptyText}
          >
            <AreaChart
              data={cumulativeData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Area
                type='monotone'
                dataKey='hours'
                name={t('analytics.labels.cumulative')}
                stroke={COLORS.education}
                fill={COLORS.education}
                fillOpacity={0.2}
              />
            </AreaChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.weekdays')}
            hint={t('analytics.charts.weekdaysHint')}
            empty={!days.length}
            emptyText={emptyText}
          >
            <BarChart
              data={weekdayData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis dataKey='label' tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip />
              <Bar
                dataKey='hours'
                name={t('analytics.hoursUnit')}
                fill={COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.gym')}
            hint={t('analytics.charts.gymHint')}
            empty={!gymData.length}
            emptyText={emptyText}
          >
            <BarChart
              data={gymData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Bar
                dataKey='sessions'
                name={t('analytics.labels.sessionsCount')}
                fill={COLORS.gym}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.sleep')}
            hint={t('analytics.charts.sleepHint')}
            empty={!sleepData.length}
            emptyText={emptyText}
          >
            <LineChart
              data={sleepData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Line
                type='monotone'
                dataKey='hours'
                name={t('analytics.labels.sleepHours')}
                stroke={COLORS.sleep}
                strokeWidth={2}
              />
            </LineChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.nutrition')}
            hint={t('analytics.charts.nutritionHint')}
            empty={!nutritionData.length}
            emptyText={emptyText}
          >
            <BarChart
              data={nutritionData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Legend />
              <Bar
                dataKey='intake'
                name={t('analytics.labels.intake')}
                fill={COLORS.intake}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey='burned'
                name={t('analytics.labels.burned')}
                fill={COLORS.burned}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.finance')}
            hint={t('analytics.charts.financeHint')}
            empty={!financeData.length}
            emptyText={emptyText}
          >
            <BarChart
              data={financeData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={60} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Legend />
              <Bar
                dataKey='income'
                name={t('analytics.labels.income')}
                fill={COLORS.income}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey='expense'
                name={t('analytics.labels.expenses')}
                fill={COLORS.expense}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartCard>

          <ChartCard
            title={t('analytics.charts.energy')}
            hint={t('analytics.charts.energyHint')}
            empty={!energyData.length}
            emptyText={emptyText}
          >
            <LineChart
              data={energyData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis
                dataKey='day'
                tickFormatter={shortJalaliLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip labelFormatter={chartTooltipLabel} />
              <Line
                type='monotone'
                dataKey='score'
                name={t('analytics.labels.energyScore')}
                stroke={COLORS.energy}
                strokeWidth={2}
              />
            </LineChart>
          </ChartCard>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <GraduationCap className='size-5' />
              {t('analytics.charts.educationSplit')}
            </CardTitle>
            <CardDescription>
              {t('analytics.charts.educationSplitHint')}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <select
              aria-label={t('goals.track')}
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={trackFilter}
              onChange={(event) =>
                setTrackFilter(event.target.value as 'all' | LearningTrack)
              }
            >
              <option value='all'>{t('analytics.allTracks')}</option>
              {LEARNING_TRACKS.map((track) => (
                <option key={track} value={track}>
                  {t(`learning.tracks.${track}`)}
                </option>
              ))}
            </select>

            {metrics && metrics.activity.educationSeconds > 0 ? (
              <>
                <div className='grid gap-4 sm:grid-cols-3'>
                  {LEARNING_TRACKS.map((track) => (
                    <div key={track} className='rounded-lg border p-3'>
                      <p className='text-sm text-muted-foreground'>
                        {t(`learning.tracks.${track}`)}
                      </p>
                      <p className='text-lg font-semibold tabular-nums'>
                        {formatHoursMinutes(trackTotals?.[track] ?? 0)}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {Math.round(
                          sharePercent(
                            trackTotals?.[track] ?? 0,
                            metrics.activity.educationSeconds
                          )
                        )}
                        %
                      </p>
                    </div>
                  ))}
                </div>
                <div className='h-64 w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart
                      data={educationChart}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray='3 3' />
                      <XAxis
                        dataKey='name'
                        interval={0}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis tick={{ fontSize: 12 }} width={40} />
                      <Tooltip />
                      <Bar
                        dataKey='hours'
                        name={t('analytics.hoursUnit')}
                        fill={COLORS.education}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {courseRows.length ? (
                  <div className='space-y-2'>
                    <p className='text-sm font-medium'>
                      {t('analytics.charts.courseShare')}
                    </p>
                    <CourseShareBars rows={courseRows} />
                  </div>
                ) : null}
              </>
            ) : (
              <p className='text-sm text-muted-foreground'>{emptyText}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Activity className='size-5' />
              {t('analytics.metrics.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className='grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4'>
            <p className='text-muted-foreground'>
              {t('analytics.daysCount')}:{' '}
              <span className='font-medium text-foreground'>{days.length}</span>
            </p>
            <p className='text-muted-foreground'>
              {t('analytics.bestDay')}:{' '}
              <span className='font-medium text-foreground'>
                {bestDay(days, combinedMap)}
              </span>
            </p>
            <p className='text-muted-foreground'>
              {t('analytics.average')}:{' '}
              <span className='font-medium text-foreground'>
                {days.length
                  ? formatHoursMinutes(totals.combined / days.length)
                  : '—'}
              </span>
            </p>
            <p className='text-muted-foreground'>
              {t('analytics.average')} + {t('analytics.metrics.gym')}:{' '}
              <span className='font-medium text-foreground'>
                {days.length
                  ? (
                      Math.round((totals.gym / days.length) * 10) / 10
                    ).toString()
                  : '—'}
              </span>
            </p>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}

function bestDay(days: string[], values: Record<string, number>): string {
  let best = ''
  let value = -1
  for (const day of days) {
    const current = values[day] ?? 0
    if (current > value) {
      value = current
      best = day
    }
  }
  return best && value > 0
    ? `${formatJalaliDateKey(best)} (${formatHoursMinutes(value)})`
    : '—'
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string
  value: string
  hint: string
}) {
  return (
    <Card className='h-full'>
      <CardContent className='space-y-1'>
        <p className='text-sm text-muted-foreground'>{title}</p>
        <p className='text-2xl font-semibold tabular-nums'>{value}</p>
        <p className='text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

/**
 * Course share bars.
 *
 * Labels live above each bar, outside the drawing area, so a long Persian
 * course name wraps instead of being clipped or overlapping the plot. The
 * percentages are the same `sharePercent` values as the table above.
 */
function CourseShareBars({
  rows,
}: {
  rows: Array<{
    courseId: string
    title: string
    seconds: number
    share: number
  }>
}) {
  const longest = Math.max(...rows.map((row) => row.seconds), 1)
  return (
    <ul className='space-y-3'>
      {rows.map((row) => (
        <li key={row.courseId} className='space-y-1.5'>
          <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm'>
            <span className='min-w-0 font-medium break-words text-foreground'>
              {row.title}
            </span>
            <span className='shrink-0 text-muted-foreground tabular-nums'>
              {formatHoursMinutes(row.seconds)} · {Math.round(row.share)}%
            </span>
          </div>
          <div
            className='h-2.5 w-full overflow-hidden rounded-full bg-muted'
            role='img'
            aria-label={`${row.title}: ${Math.round(row.share)}%`}
          >
            <div
              className='h-full rounded-full bg-violet-500/80'
              style={{
                width: `${Math.max(2, (row.seconds / longest) * 100)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ChartCard({
  title,
  hint,
  empty,
  emptyText,
  action,
  children,
}: {
  title: string
  hint: string
  empty: boolean
  emptyText: string
  action?: ReactNode
  children: ReactElement
}) {
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div>
            <CardTitle className='text-base'>{title}</CardTitle>
            <CardDescription>{hint}</CardDescription>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className='py-10 text-center text-sm text-muted-foreground'>
            {emptyText}
          </p>
        ) : (
          <div className='h-64 w-full'>
            <ResponsiveContainer width='100%' height='100%'>
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
