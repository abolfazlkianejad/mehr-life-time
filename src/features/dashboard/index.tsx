import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TimelineBlockRecord } from '@/types/timeline'
import {
  CalendarDays,
  Dumbbell,
  Flame,
  FolderGit2,
  GraduationCap,
  ListTodo,
  Target,
  Timer,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey, formatJalaliLong } from '@/lib/jalali'
import {
  combinedByDay,
  loadActivityRange,
  type ActivityRange,
} from '@/services/activity'
import {
  getAllWorkTasks,
  getFinanceEntriesByRange,
  getMealLogsByRange,
  LEARNING_TRACKS,
  type FinanceEntry,
  type MealLog,
} from '@/services/db'
import { getEducationTasks, type EducationTask } from '@/services/education'
import { findGoal, getGoals, type GoalRecord } from '@/services/goals'
import {
  getAllGymExercises,
  getGymPlans,
  getGymSessions,
  type GymExercise,
  type GymPlan,
  type GymSession,
} from '@/services/gym'
import { getEducationItems, type EducationItem } from '@/services/learning'
import { getCardioLogsByRange, type CardioLog } from '@/services/nutrition'
import { getProjects, type Project } from '@/services/projects'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  classifyGoalThreshold,
  GoalProgressBar,
  goalThresholdTextClass,
} from '@/features/goals/goal-progress-bar'
import {
  evaluateGoal,
  formatHoursMinutes,
  weekdayLabel,
  weekKeysOf,
} from '@/features/goals/goal-utils'
import { buildExerciseActivities } from './exercise-activities'
import { TasksOverview } from './tasks-overview'

export function Dashboard() {
  const { t, i18n } = useTranslation()
  const today = toDateKey(new Date())

  const [selectedDate, setSelectedDate] = useState(today)
  /** Saturday-first week of the selected day, so the weekly cards follow it. */
  const weekDays = useMemo(() => weekKeysOf(selectedDate), [selectedDate])
  const [week, setWeek] = useState<ActivityRange | null>(null)
  const [dayActivity, setDayActivity] = useState<ActivityRange | null>(null)
  const [workTasks, setWorkTasks] = useState<TimelineBlockRecord[]>([])
  const [educationTasks, setEducationTasks] = useState<EducationTask[]>([])
  const [gymPlans, setGymPlans] = useState<GymPlan[]>([])
  const [gymExercises, setGymExercises] = useState<GymExercise[]>([])
  const [gymSessions, setGymSessions] = useState<GymSession[]>([])
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [educationItems, setEducationItems] = useState<EducationItem[]>([])
  const [finance, setFinance] = useState<FinanceEntry[]>([])
  const [meals, setMeals] = useState<MealLog[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader
    setLoading(true)
    setError('')
    void Promise.all([
      loadActivityRange(weekDays[0]!, weekDays[6]!),
      loadActivityRange(selectedDate, selectedDate),
      getAllWorkTasks(),
      getEducationTasks(),
      getGymPlans(),
      getAllGymExercises(),
      getGymSessions(),
      getGoals(),
      getProjects(),
      getEducationItems(),
      getFinanceEntriesByRange(selectedDate, selectedDate),
      getMealLogsByRange(selectedDate, selectedDate),
      getCardioLogsByRange(selectedDate, selectedDate),
    ])
      .then(
        ([
          weekData,
          dayData,
          workRows,
          educationRows,
          planRows,
          exerciseRows,
          gymRows,
          goalRows,
          projectRows,
          itemRows,
          financeRows,
          mealRows,
          cardioRows,
        ]) => {
          if (!active) return
          setWeek(weekData)
          setDayActivity(dayData)
          setWorkTasks(workRows)
          setEducationTasks(educationRows)
          setGymPlans(planRows)
          setGymExercises(exerciseRows)
          setGymSessions(gymRows)
          setGoals(goalRows)
          setProjects(projectRows)
          setEducationItems(itemRows)
          setFinance(financeRows)
          setMeals(mealRows)
          setCardio(cardioRows)
        }
      )
      .catch(() => {
        if (active) setError(t('dashboard.loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedDate, t, weekDays])

  /**
   * Reloads only what a timer action can change: task lists, gym sessions and
   * the activity aggregates the summary cards read. It never writes anything.
   */
  const reloadTasks = useCallback(async () => {
    const [
      workRows,
      educationRows,
      planRows,
      exerciseRows,
      gymRows,
      weekData,
      dayData,
    ] = await Promise.all([
      getAllWorkTasks(),
      getEducationTasks(),
      getGymPlans(),
      getAllGymExercises(),
      getGymSessions(),
      loadActivityRange(weekDays[0]!, weekDays[6]!),
      loadActivityRange(selectedDate, selectedDate),
    ])
    setWorkTasks(workRows)
    setEducationTasks(educationRows)
    setGymPlans(planRows)
    setGymExercises(exerciseRows)
    setGymSessions(gymRows)
    setWeek(weekData)
    setDayActivity(dayData)
  }, [selectedDate, weekDays])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const combinedWeek = useMemo(() => (week ? combinedByDay(week) : {}), [week])
  const weekSeconds = useMemo(
    () => weekDays.reduce((total, day) => total + (combinedWeek[day] ?? 0), 0),
    [combinedWeek, weekDays]
  )
  const weeklyGoal = findGoal(goals, 'work_education', 'weekly')
  const dailyGoal = findGoal(goals, 'work_education', 'daily')
  const weeklyProgress = evaluateGoal(weeklyGoal?.target, weekSeconds)
  const selectedDaySeconds =
    (dayActivity?.workByDay[selectedDate] ?? 0) +
    (dayActivity?.educationByDay[selectedDate] ?? 0)
  const dailyProgress = evaluateGoal(dailyGoal?.target, selectedDaySeconds)
  const weeklyThreshold = classifyGoalThreshold({
    actual: weekSeconds,
    weeklyTarget: weeklyGoal?.target,
    dailyTarget: dailyGoal?.target,
    period: 'weekly',
  })
  const dailyThreshold = classifyGoalThreshold({
    actual: selectedDaySeconds,
    weeklyTarget: weeklyGoal?.target,
    dailyTarget: dailyGoal?.target,
  })

  const selectedWorkTasks = useMemo(
    () => workTasks.filter((task) => task.dateKey === selectedDate),
    [workTasks, selectedDate]
  )
  const selectedEducationTasks = useMemo(
    () => educationTasks.filter((task) => task.dateKey === selectedDate),
    [educationTasks, selectedDate]
  )
  const selectedGymSessions = useMemo(
    () => gymSessions.filter((session) => session.dateKey === selectedDate),
    [gymSessions, selectedDate]
  )
  /** Plans become cards only when the day has no session for that plan. */
  const exerciseActivities = useMemo(
    () =>
      buildExerciseActivities(
        gymPlans,
        gymExercises,
        gymSessions,
        selectedDate,
        now
      ),
    [gymPlans, gymExercises, gymSessions, selectedDate, now]
  )

  const remainingTasks =
    selectedWorkTasks.filter(
      (task) => task.status !== 'completed' && task.status !== 'skipped'
    ).length +
    selectedEducationTasks.filter((task) => task.status !== 'completed').length

  const projectHours = useMemo(() => {
    const map = dayActivity?.workByProjectByDay[selectedDate] ?? {}
    return Object.entries(map)
      .filter(([, seconds]) => seconds > 0)
      .map(([projectId, seconds]) => ({
        projectId,
        title:
          projects.find((project) => project.id === projectId)?.title ??
          projectId,
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds)
  }, [dayActivity, projects, selectedDate])

  const educationTotal = dayActivity?.educationSeconds ?? 0
  const courseRows = useMemo(() => {
    if (!dayActivity) return []
    return Object.entries(dayActivity.educationByCourse)
      .filter(([, seconds]) => seconds > 0)
      .map(([courseId, seconds]) => ({
        courseId,
        title:
          educationItems.find((item) => item.id === courseId)?.title ??
          courseId,
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds)
  }, [dayActivity, educationItems])

  const financeTotals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const entry of finance) {
      if (entry.type === 'income') income += entry.amount
      if (entry.type === 'expense') expense += entry.amount
    }
    return { income, expense }
  }, [finance])

  const nutritionTotals = useMemo(
    () => ({
      intake: meals.reduce((total, meal) => total + meal.calories, 0),
      burned: cardio.reduce((total, entry) => total + entry.calories, 0),
    }),
    [meals, cardio]
  )

  const money = (amount: number) =>
    `${new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US').format(amount)} ${t('finance.toman')}`

  const formatSeconds = (seconds: number) =>
    `${formatHoursMinutes(seconds)} ${t('analytics.hoursUnit')}`

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            {t('dashboard.title')}
          </h2>
          <p className='text-muted-foreground'>{t('dashboard.subtitle')}</p>
        </div>

        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}

        {/* 1 — four summary cards */}
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <Card className='border-primary/20 bg-gradient-to-br from-primary/5 to-transparent'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <CalendarDays className='size-5' />
                {weekdayLabel(today, i18n.language)}
              </CardTitle>
              <CardDescription className='text-base font-medium text-foreground'>
                {formatJalaliLong(today)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className='text-sm text-muted-foreground'>
                {formatJalaliDateKey(today)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Target className='size-5 text-indigo-500' />
                {t('dashboard.weekWorkTitle')}
              </CardTitle>
              <CardDescription>
                {t('dashboard.weekRange', {
                  from: formatJalaliDateKey(weekDays[0]),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              <p className='text-2xl font-semibold tabular-nums'>
                {formatSeconds(weekSeconds)}
              </p>
              {weeklyProgress.status === 'unset' ? (
                <p className='text-xs text-muted-foreground'>
                  {t('dashboard.noGoal')}
                </p>
              ) : (
                <>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.goalWeekly')}:{' '}
                      {formatSeconds(weeklyProgress.target)}
                    </span>
                    <span
                      className={`font-medium tabular-nums ${goalThresholdTextClass(weeklyThreshold)}`}
                    >
                      {t('dashboard.weekProgress', {
                        percent: Math.round(weeklyProgress.rawPercent),
                      })}
                    </span>
                  </div>
                  <GoalProgressBar
                    progress={weeklyProgress}
                    weeklyTarget={weeklyGoal?.target}
                    dailyTarget={dailyGoal?.target}
                    period='weekly'
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Timer className='size-5 text-emerald-500' />
                {t('dashboard.selectedDayWorkTitle')}
              </CardTitle>
              <CardDescription>
                {formatJalaliDateKey(selectedDate)}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              <p className='text-2xl font-semibold tabular-nums'>
                {formatSeconds(selectedDaySeconds)}
              </p>
              {dailyProgress.status === 'unset' ? (
                <p className='text-xs text-muted-foreground'>
                  {t('dashboard.noGoal')}
                </p>
              ) : (
                <>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.goalDaily')}:{' '}
                      {formatSeconds(dailyProgress.target)}
                    </span>
                    <span
                      className={`font-medium tabular-nums ${goalThresholdTextClass(dailyThreshold)}`}
                    >
                      {t('dashboard.todayProgress', {
                        percent: Math.round(dailyProgress.rawPercent),
                      })}
                    </span>
                  </div>
                  <GoalProgressBar
                    progress={dailyProgress}
                    weeklyTarget={weeklyGoal?.target}
                    dailyTarget={dailyGoal?.target}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <ListTodo className='size-5 text-amber-500' />
                {t('dashboard.remainingTasksTitle')}
              </CardTitle>
              <CardDescription>
                {formatJalaliDateKey(selectedDate)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className='text-2xl font-semibold tabular-nums'>
                {remainingTasks}
              </p>
              <p className='text-xs text-muted-foreground'>
                {t('dashboard.remainingTasksHint')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 2 — one interactive board for every work and education task */}
        <TasksOverview
          workTasks={workTasks}
          educationTasks={educationTasks}
          educationItems={educationItems}
          projects={projects}
          exerciseActivities={exerciseActivities}
          now={now}
          loading={loading}
          loadError={Boolean(error)}
          dateKey={selectedDate}
          onDateChange={setSelectedDate}
          onChanged={reloadTasks}
        />

        {/* 3 — selected-day summaries: project hours, education split, gym */}
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h3 className='text-lg font-semibold'>
              {t('dashboard.daySummaryTitle')}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {t('dashboard.daySummaryHint')}
            </p>
          </div>
          <Badge
            variant='secondary'
            className='gap-1.5 px-3 py-1.5 text-sm font-medium'
            title={t('dashboard.selectDate')}
          >
            <CalendarDays className='size-4 opacity-70' />
            <span className='sr-only'>{t('dashboard.selectDate')}: </span>
            <span className='tabular-nums'>
              {formatJalaliDateKey(selectedDate)}
            </span>
          </Badge>
        </div>

        {/* 4 — project hours and education split of the selected day */}
        <div className='grid gap-4 xl:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <FolderGit2 className='size-5 text-sky-600' />
                {t('dashboard.projectSummary')}
              </CardTitle>
              <CardDescription>
                {t('dashboard.projectSummaryHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>
                  {t('dashboard.loading')}
                </p>
              ) : error ? (
                <p role='alert' className='text-sm text-destructive'>
                  {t('dashboard.loadError')}
                </p>
              ) : projectHours.length ? (
                <ul className='space-y-2'>
                  {projectHours.map((row) => (
                    <li
                      key={row.projectId}
                      className='flex items-center justify-between gap-2 rounded-md border p-3 text-sm'
                    >
                      <span className='font-medium'>{row.title}</span>
                      <span className='tabular-nums'>
                        {formatHoursMinutes(row.seconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('dashboard.noProjectHours')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <GraduationCap className='size-5 text-indigo-500' />
                {t('dashboard.educationSummary')}
              </CardTitle>
              <CardDescription>
                {t('dashboard.educationSummaryHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>
                  {t('dashboard.loading')}
                </p>
              ) : error ? (
                <p role='alert' className='text-sm text-destructive'>
                  {t('dashboard.loadError')}
                </p>
              ) : educationTotal > 0 ? (
                <div className='space-y-3'>
                  <div className='grid gap-2 sm:grid-cols-3'>
                    {LEARNING_TRACKS.map((track) => (
                      <div key={track} className='rounded-md border p-2'>
                        <p className='text-xs text-muted-foreground'>
                          {t(`learning.tracks.${track}`)}
                        </p>
                        <p className='font-semibold tabular-nums'>
                          {formatHoursMinutes(
                            dayActivity?.educationByTrack[track] ?? 0
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                  {courseRows.length ? (
                    <ul className='space-y-1 text-sm'>
                      {courseRows.map((row) => (
                        <li
                          key={row.courseId}
                          className='flex items-center justify-between gap-2 border-b py-1 last:border-0'
                        >
                          <span>{row.title}</span>
                          <span className='flex items-center gap-2 tabular-nums'>
                            <span>{formatHoursMinutes(row.seconds)}</span>
                            <Badge variant='outline'>
                              {Math.round((row.seconds / educationTotal) * 100)}
                              %
                            </Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('dashboard.noEducationHours')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 5 — finance, nutrition and gym sessions of the selected day */}
        <div className='grid gap-4 lg:grid-cols-3'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Wallet className='size-5 text-emerald-600' />
                {t('dashboard.financeSummary')}
              </CardTitle>
              <CardDescription>
                {formatJalaliDateKey(selectedDate)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>
                  {t('dashboard.loading')}
                </p>
              ) : finance.length ? (
                <div className='grid gap-2 text-sm sm:grid-cols-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.income')}
                    </span>
                    <strong className='tabular-nums'>
                      {money(financeTotals.income)}
                    </strong>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.expenses')}
                    </span>
                    <strong className='tabular-nums'>
                      {money(financeTotals.expense)}
                    </strong>
                  </div>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('dashboard.noFinance')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Flame className='size-5 text-orange-500' />
                {t('dashboard.nutritionSummary')}
              </CardTitle>
              <CardDescription>
                {formatJalaliDateKey(selectedDate)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>
                  {t('dashboard.loading')}
                </p>
              ) : nutritionTotals.intake || nutritionTotals.burned ? (
                <div className='grid gap-2 text-sm sm:grid-cols-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.intake')}
                    </span>
                    <strong className='tabular-nums'>
                      {nutritionTotals.intake} kcal
                    </strong>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>
                      {t('dashboard.burned')}
                    </span>
                    <strong className='tabular-nums'>
                      {nutritionTotals.burned} kcal
                    </strong>
                  </div>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('dashboard.noNutrition')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Dumbbell className='size-5 text-emerald-500' />
                {t('dashboard.workout')}
              </CardTitle>
              <CardDescription>
                {formatJalaliDateKey(selectedDate)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>
                  {t('dashboard.loading')}
                </p>
              ) : selectedGymSessions.length ? (
                // Only totals live here: individual sessions are task cards.
                <div className='grid gap-2 text-sm sm:grid-cols-2'>
                  <div className='flex items-center justify-between gap-2 rounded-md border p-2'>
                    <span className='text-muted-foreground'>
                      {t('gym.sessionDone')}
                    </span>
                    <strong className='tabular-nums'>
                      {
                        selectedGymSessions.filter(
                          (session) => session.status === 'done'
                        ).length
                      }
                    </strong>
                  </div>
                  <div className='flex items-center justify-between gap-2 rounded-md border p-2'>
                    <span className='text-muted-foreground'>
                      {t('gym.actualDuration')}
                    </span>
                    <strong className='tabular-nums'>
                      {formatSeconds(
                        selectedGymSessions.reduce((total, session) => {
                          const measured = session.actualSeconds
                          return (
                            total +
                            (typeof measured === 'number' &&
                            Number.isFinite(measured)
                              ? Math.max(0, measured)
                              : 0)
                          )
                        }, 0)
                      )}
                    </strong>
                  </div>
                  <p className='text-xs text-muted-foreground sm:col-span-2'>
                    {t('dashboard.workoutSummaryHint')}
                  </p>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('dashboard.noGymSessions')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
