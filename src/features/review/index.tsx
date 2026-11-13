import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, BookOpen, HeartPulse, Soup, Timer, Dumbbell, Moon, Flame } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import {
  getDashboardDay,
  getEnergyLogsByDate,
  getMealLogs,
  getStudyLogs,
  getVitals,
  getWorkSessionsByDate,
  getWorkTasksByDate,
  getWorkoutLogs,
  type DashboardDayRecord,
  type StudyLog,
  type VitalRecord,
  type WorkoutSet,
} from '@/services/db'
import { getCardioLogs } from '@/services/nutrition'
import type { EnergyLogRecord } from '@/types/timeline'
import { toDateKey } from '@/lib/date-key'
import { calculateWorkTime } from '@/lib/work-time'
import { summarizeNutrition } from '@/features/nutrition/nutrition-utils'
import { trackOfLog } from '@/features/learning/learning-utils'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTimeValue } from '@/lib/time'

function bpState(reading?: VitalRecord): 'normal' | 'high' | 'low' | 'missing' {
  if (!reading) return 'missing'
  if (reading.systolic >= 140 || reading.diastolic >= 90) return 'high'
  if (reading.systolic < 90 || reading.diastolic < 60) return 'low'
  return 'normal'
}

export function DayReviewPage() {
  const { t, i18n } = useTranslation()
  const [date, setDate] = useState(toDateKey(new Date()))
  const [day, setDay] = useState<DashboardDayRecord | undefined>()
  const [morning, setMorning] = useState<VitalRecord>()
  const [evening, setEvening] = useState<VitalRecord>()
  const [workHours, setWorkHours] = useState<number | undefined>()
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [energyLogs, setEnergyLogs] = useState<EnergyLogRecord[]>([])
  const [nutrition, setNutrition] = useState<ReturnType<typeof summarizeNutrition> | null>(null)
  const [mealLines, setMealLines] = useState<Array<{ id: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    setLoading(true)
    setLoadError(false)
    void Promise.all([
      getDashboardDay(date),
      getMealLogs(date),
      getCardioLogs(date),
      getVitals(date),
      getWorkSessionsByDate(date),
      getWorkTasksByDate(date),
      getWorkoutLogs(date),
      getStudyLogs(date),
      getEnergyLogsByDate(date),
    ])
      .then(([savedDay, meals, cardio, vitals, sessions, tasks, workouts, study, energy]) => {
        if (!active) return
        setDay(savedDay)
        setNutrition(summarizeNutrition(meals, cardio))
        setMealLines(
          meals.map((meal) => ({
            id: meal.id,
            label: `${meal.description} · ${meal.calories} kcal`,
          }))
        )
        setMorning(vitals.find((vital) => vital.period === 'morning'))
        setEvening(vitals.find((vital) => vital.period === 'evening'))
        const actualWork = calculateWorkTime(tasks, sessions, 'all').seconds
        const hasActualWork = sessions.length > 0 || tasks.some((task) => (task.elapsedSeconds ?? 0) > 0)
        setWorkHours(hasActualWork ? actualWork / 3600 : undefined)
        setSets(workouts)
        setStudyLogs(study)
        setEnergyLogs(energy)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [date])

  const studyMinutes = useMemo(
    () => studyLogs.reduce((total, log) => total + log.minutes, 0),
    [studyLogs]
  )
  const energyAverage = useMemo(
    () =>
      energyLogs.length
        ? (energyLogs.reduce((total, log) => total + log.score, 0) / energyLogs.length).toFixed(1)
        : null,
    [energyLogs]
  )
  const hasAnyData = Boolean(
    day?.sleepTime ||
      day?.wakeTime ||
      day?.bookName ||
      day?.readingMinutes !== undefined ||
      day?.note?.trim() ||
      morning ||
      evening ||
      workHours !== undefined ||
      sets.length ||
      studyLogs.length ||
      energyLogs.length ||
      (nutrition && (nutrition.intake > 0 || nutrition.burned > 0))
  )
  const needsReview = [bpState(morning), bpState(evening)].some(
    (state) => state === 'high' || state === 'low'
  )
  const status = !hasAnyData
    ? 'unknown'
    : needsReview
      ? 'review'
      : (workHours ?? 0) >= 4
        ? 'productive'
        : 'logged'

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('review.title')}</h2>
          <p className='text-muted-foreground'>{t('review.subtitle')}</p>
        </div>
        <label className='flex max-w-xs flex-col gap-2 text-sm font-medium'>
          {t('review.date')}
          <JalaliDatePicker value={date} onChange={setDate} ariaLabel={t('review.date')} />
        </label>
        {loading && <p role='status' className='text-sm text-muted-foreground'>{t('review.loading')}</p>}
        {loadError && <p role='alert' className='text-sm text-destructive'>{t('review.loadError')}</p>}

        <Card className='border-primary/30'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Activity className='size-5' />
              {t('review.dayStatus')}
            </CardTitle>
            <CardDescription>{t('review.statusHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={status === 'productive' ? 'default' : status === 'unknown' ? 'outline' : 'secondary'}>
              {t(`review.status.${status}`)}
            </Badge>
          </CardContent>
        </Card>

        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Timer className='size-5' />
                {t('review.workHours')}
              </CardTitle>
            </CardHeader>
            <CardContent className='text-2xl font-bold tabular-nums'>
              {workHours === undefined ? t('review.notRecorded') : <>{workHours.toFixed(1)} {t('review.hours')}</>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <HeartPulse className='size-5' />
                {t('review.bloodPressure')}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {(['morning', 'evening'] as const).map((period) => {
                const value = period === 'morning' ? morning : evening
                return (
                  <div key={period} className='flex justify-between gap-2'>
                    <span>{t(`review.${period}`)}</span>
                    <span>
                      {value ? `${value.systolic}/${value.diastolic} · ` : ''}
                      {t(`review.bp.${bpState(value)}`)}
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Soup className='size-5' />
                {t('review.calories')}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <p className='text-2xl font-bold tabular-nums'>
                {nutrition && nutrition.intake > 0 ? <>{nutrition.intake} kcal</> : t('review.notRecorded')}
              </p>
              {nutrition && nutrition.burned > 0 ? (
                <p className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <Flame className='size-3.5' />
                  {t('nutrition.summary.burned')}: {nutrition.burned} kcal · {t('nutrition.summary.net')}: {nutrition.net} kcal
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Dumbbell className='size-5' />
                {t('review.exercise')}
              </CardTitle>
            </CardHeader>
            <CardContent className='text-sm'>
              {sets.length ? (
                <>
                  {t('review.setCount', { count: sets.length })}
                  <ul className='mt-2 space-y-1 text-muted-foreground'>
                    {sets.map((set) => (
                      <li key={set.id}>
                        {set.exercise}: {set.weightKg} kg × {set.reps}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                t('review.notRecorded')
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <BookOpen className='size-5' />
                {t('review.study')}
              </CardTitle>
            </CardHeader>
            <CardContent className='text-sm'>
              {studyLogs.length ? (
                <>
                  {t('review.studySummary', { minutes: studyMinutes, count: studyLogs.length })}
                  <ul className='mt-2 space-y-1 text-muted-foreground'>
                    {studyLogs.map((log) => (
                      <li key={log.id}>
                        {t(`learning.tracks.${trackOfLog(log)}`)}
                        {log.note ? ` · ${log.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                t('review.notRecorded')
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Activity className='size-5' />
                {t('review.energy')}
              </CardTitle>
            </CardHeader>
            <CardContent className='text-sm'>
              {energyAverage === null
                ? t('review.notRecorded')
                : t('review.energySummary', { average: energyAverage, count: energyLogs.length })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Moon className='size-5' />
                {t('review.sleep')}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {day?.sleepTime || day?.wakeTime ? (
                <>
                  {day.sleepTime && <p>{t('review.sleepTime')}: {formatClockTimeValue(day.sleepTime, i18n.language)}</p>}
                  {day.wakeTime && <p>{t('review.wakeTime')}: {formatClockTimeValue(day.wakeTime, i18n.language)}</p>}
                </>
              ) : (
                t('review.notRecorded')
              )}
              {day?.bookName && <p>{t('review.book')}: {day.bookName}</p>}
              {day?.readingMinutes !== undefined && (
                <p>{t('review.readingMinutes', { count: day.readingMinutes })}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('review.mealsTitle')}</CardTitle>
            <CardDescription>{formatJalaliDateKey(date)}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {mealLines.length ? (
              mealLines.map((meal) => (
                <p key={meal.id} className='border-b py-1 text-sm'>
                  {meal.label}
                </p>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>{t('review.noMeals')}</p>
            )}
            <a className='inline-block text-sm text-primary underline' href='/nutrition'>
              {t('review.openNutrition')}
            </a>
          </CardContent>
        </Card>

        {day?.note?.trim() ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('review.quickNote')}</CardTitle>
              <CardDescription>{formatJalaliDateKey(date)}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className='whitespace-pre-wrap text-sm'>{day.note}</p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !hasAnyData && <p className='text-sm text-muted-foreground'>{t('review.empty')}</p>}
      </Main>
    </>
  )
}
