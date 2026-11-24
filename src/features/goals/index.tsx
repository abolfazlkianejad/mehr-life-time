import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dumbbell,
  GraduationCap,
  Plus,
  Save,
  Target,
  Timer,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliLong } from '@/lib/jalali'
import {
  combinedByDay,
  loadActivityRange,
  type ActivityRange,
} from '@/services/activity'
import { LEARNING_TRACKS, type LearningTrack } from '@/services/db'
import {
  deleteGoal,
  findGoal,
  getGoals,
  saveGoal,
  type GoalRecord,
} from '@/services/goals'
import { getEducationItems, type EducationItem } from '@/services/learning'
import { getProjects, type Project } from '@/services/projects'
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
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GoalProgressBar } from './goal-progress-bar'
import {
  evaluateGoal,
  formatHoursMinutes,
  hoursToSeconds,
  secondsToHoursInput,
  weekdayLabel,
  weekKeysOf,
  type GoalProgress,
} from './goal-utils'

function GoalNumbers({
  progress,
  unit,
}: {
  progress: GoalProgress
  unit: 'hours' | 'sessions'
}) {
  const { t } = useTranslation()
  const format = (value: number) =>
    unit === 'hours'
      ? formatHoursMinutes(value)
      : String(Math.round(value * 10) / 10)
  return (
    <div className='grid grid-cols-2 gap-2 text-sm sm:grid-cols-4'>
      <div>
        <p className='text-muted-foreground'>{t('goals.target')}</p>
        <p className='font-semibold tabular-nums'>{format(progress.target)}</p>
      </div>
      <div>
        <p className='text-muted-foreground'>{t('goals.actual')}</p>
        <p className='font-semibold tabular-nums'>{format(progress.actual)}</p>
      </div>
      <div>
        <p className='text-muted-foreground'>{t('goals.diff')}</p>
        <p
          className={`font-semibold tabular-nums ${progress.status === 'met' ? 'text-emerald-600' : progress.status === 'below' ? 'text-destructive' : ''}`}
        >
          {progress.diff >= 0 ? '+' : '−'}
          {format(Math.abs(progress.diff))}
        </p>
      </div>
      <div>
        <p className='text-muted-foreground'>{t('goals.percent')}</p>
        <p className='font-semibold tabular-nums'>
          {Math.round(progress.rawPercent)}%
        </p>
      </div>
    </div>
  )
}

function GoalStateBadge({ progress }: { progress: GoalProgress }) {
  const { t } = useTranslation()
  if (progress.status === 'unset')
    return <Badge variant='outline'>{t('goals.unset')}</Badge>
  return (
    <Badge variant={progress.status === 'met' ? 'default' : 'destructive'}>
      {progress.status === 'met' ? t('goals.met') : t('goals.below')}
    </Badge>
  )
}

export function GoalsPage() {
  const { t, i18n } = useTranslation()
  const today = toDateKey(new Date())
  const [weekOffset, setWeekOffset] = useState(0)
  /** Saturday-first week of the selected offset; `0` is the current week. */
  const weekDays = useMemo(() => {
    const base = new Date(`${today}T00:00:00`)
    base.setDate(base.getDate() - weekOffset * 7)
    return weekKeysOf(toDateKey(base))
  }, [today, weekOffset])

  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [week, setWeek] = useState<ActivityRange | null>(null)
  const [day, setDay] = useState<ActivityRange | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [items, setItems] = useState<EducationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const [workDaily, setWorkDaily] = useState('0')
  const [workWeekly, setWorkWeekly] = useState('0')
  const [gymWeekly, setGymWeekly] = useState('0')

  const [extraAxis, setExtraAxis] = useState<'education_track' | 'project'>(
    'education_track'
  )
  const [extraTrack, setExtraTrack] = useState<LearningTrack>('masters')
  const [extraProject, setExtraProject] = useState('')
  const [extraPeriod, setExtraPeriod] = useState<'daily' | 'weekly'>('weekly')
  const [extraTarget, setExtraTarget] = useState('2')

  const load = useCallback(async () => {
    const [savedGoals, weekActivity, dayActivity, projectList, educationItems] =
      await Promise.all([
        getGoals(),
        loadActivityRange(weekDays[0]!, weekDays[6]!),
        loadActivityRange(today, today),
        getProjects(),
        getEducationItems(),
      ])
    setGoals(savedGoals)
    setWeek(weekActivity)
    setDay(dayActivity)
    setProjects(projectList)
    setItems(educationItems)
    const workDailyGoal = findGoal(savedGoals, 'work_education', 'daily')
    const workWeeklyGoal = findGoal(savedGoals, 'work_education', 'weekly')
    const gymWeeklyGoal = findGoal(savedGoals, 'gym', 'weekly')
    setWorkDaily(secondsToHoursInput(workDailyGoal?.target ?? 0))
    setWorkWeekly(secondsToHoursInput(workWeeklyGoal?.target ?? 0))
    setGymWeekly(String(gymWeeklyGoal?.target ?? 0))
    if (!extraProject && projectList[0]) setExtraProject(projectList[0].id)
  }, [extraProject, today, weekDays])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader
    setLoading(true)
    setError('')
    void load()
      .catch(() => {
        if (active) setError(t('goals.loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load, t])

  const combinedWeek = useMemo(() => (week ? combinedByDay(week) : {}), [week])
  const combinedDay = useMemo(() => (day ? combinedByDay(day) : {}), [day])

  const dailyTarget = findGoal(goals, 'work_education', 'daily')?.target
  const weeklyTarget = findGoal(goals, 'work_education', 'weekly')?.target
  const workDailyProgress = evaluateGoal(dailyTarget, combinedDay[today] ?? 0)
  const workWeeklyProgress = evaluateGoal(
    weeklyTarget,
    weekDays.reduce((total, key) => total + (combinedWeek[key] ?? 0), 0)
  )
  const gymWeeklyProgress = evaluateGoal(
    findGoal(goals, 'gym', 'weekly')?.target,
    weekDays.reduce((total, key) => total + (week?.gymByDay[key] ?? 0), 0)
  )
  const gymRemaining = Math.max(
    0,
    gymWeeklyProgress.target - gymWeeklyProgress.actual
  )

  const saveMain = async () => {
    setError('')
    setSaved('')
    try {
      await saveGoal({
        axis: 'work_education',
        period: 'daily',
        target: hoursToSeconds(workDaily),
      })
      await saveGoal({
        axis: 'work_education',
        period: 'weekly',
        target: hoursToSeconds(workWeekly),
      })
      await saveGoal({
        axis: 'gym',
        period: 'weekly',
        target: Math.max(1, Math.round(Number(gymWeekly))),
      })
      await load()
      setSaved(t('goals.saved'))
    } catch {
      setError(t('goals.saveError'))
    }
  }

  const saveExtra = async () => {
    setError('')
    setSaved('')
    try {
      const target = hoursToSeconds(extraTarget)
      if (extraAxis === 'education_track') {
        await saveGoal({
          axis: 'education_track',
          period: extraPeriod,
          track: extraTrack,
          target,
        })
      } else {
        if (!extraProject) return
        await saveGoal({
          axis: 'project',
          period: extraPeriod,
          projectId: extraProject,
          target,
        })
      }
      await load()
      setSaved(t('goals.saved'))
    } catch {
      setError(t('goals.saveError'))
    }
  }

  const removeGoal = async (goal: GoalRecord) => {
    if (!window.confirm(t('goals.deleteConfirm'))) return
    await deleteGoal(goal.id)
    await load()
  }

  const courseTitle = (id: string) =>
    items.find((item) => item.id === id)?.title ?? id
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? id

  const extraGoals = goals.filter(
    (goal) => goal.axis === 'education_track' || goal.axis === 'project'
  )

  const optionalRows = extraGoals.map((goal) => {
    const byDay =
      goal.axis === 'education_track'
        ? (goal.period === 'weekly' ? week : day)?.educationByTrack[
            goal.track ?? 'masters'
          ]
        : goal.period === 'weekly'
          ? week?.workByProject[goal.projectId ?? '']
          : day?.workByProject[goal.projectId ?? '']
    const progress = evaluateGoal(goal.target, byDay ?? 0)
    return { goal, progress }
  })

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('goals.title')}</h2>
          <p className='text-muted-foreground'>{t('goals.subtitle')}</p>
        </div>

        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role='status' className='text-sm text-emerald-600'>
            {saved}
          </p>
        ) : null}
        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('goals.loading')}
          </p>
        ) : null}

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-sm text-muted-foreground'>
            {t('goals.context', {
              day: formatJalaliLong(today),
              from: formatJalaliLong(weekDays[0]),
              to: formatJalaliLong(weekDays[6]),
            })}
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setWeekOffset((current) => current + 1)}
            >
              {t('goals.previousWeek')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={weekOffset === 0}
              onClick={() => setWeekOffset(0)}
            >
              {t('goals.thisWeek')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={weekOffset === 0}
              onClick={() =>
                setWeekOffset((current) => Math.max(0, current - 1))
              }
            >
              {t('goals.nextWeek')}
            </Button>
          </div>
        </div>

        <div className='grid gap-4 xl:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Timer className='size-5' />
                {t('goals.axes.work_education')}
              </CardTitle>
              <CardDescription>{t('goals.workHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-5'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-2 rounded-lg border p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-sm font-medium'>
                      {t('goals.period.daily')}
                    </p>
                    <GoalStateBadge progress={workDailyProgress} />
                  </div>
                  <GoalNumbers progress={workDailyProgress} unit='hours' />
                  <GoalProgressBar
                    progress={workDailyProgress}
                    weeklyTarget={weeklyTarget}
                    dailyTarget={dailyTarget}
                  />
                </div>
                <div className='space-y-2 rounded-lg border p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-sm font-medium'>
                      {t('goals.period.weekly')}
                    </p>
                    <GoalStateBadge progress={workWeeklyProgress} />
                  </div>
                  <GoalNumbers progress={workWeeklyProgress} unit='hours' />
                  <GoalProgressBar
                    progress={workWeeklyProgress}
                    weeklyTarget={weeklyTarget}
                    dailyTarget={dailyTarget}
                    period='weekly'
                  />
                </div>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <label className='space-y-1 text-sm'>
                  <span className='text-muted-foreground'>
                    {t('goals.dailyTargetHours')}
                  </span>
                  <Input
                    type='number'
                    min='0.25'
                    step='0.25'
                    value={workDaily}
                    onChange={(event) => setWorkDaily(event.target.value)}
                  />
                </label>
                <label className='space-y-1 text-sm'>
                  <span className='text-muted-foreground'>
                    {t('goals.weeklyTargetHours')}
                  </span>
                  <Input
                    type='number'
                    min='0.5'
                    step='0.5'
                    value={workWeekly}
                    onChange={(event) => setWorkWeekly(event.target.value)}
                  />
                </label>
              </div>
              <p className='text-xs text-muted-foreground'>
                {t('goals.workSourceHint')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Dumbbell className='size-5' />
                {t('goals.axes.gym')}
              </CardTitle>
              <CardDescription>{t('goals.gymHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-5'>
              <div className='space-y-3 rounded-lg border p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='text-sm font-medium'>
                    {t('goals.period.weekly')}
                  </p>
                  <GoalStateBadge progress={gymWeeklyProgress} />
                </div>
                <GoalNumbers progress={gymWeeklyProgress} unit='sessions' />
                <GoalProgressBar progress={gymWeeklyProgress} mode='status' />
                <p className='text-sm'>
                  {t('goals.gymRemainingLabel')}:{' '}
                  <span className='font-semibold tabular-nums'>
                    {gymRemaining}
                  </span>
                </p>
              </div>
              <label className='block space-y-1 text-sm sm:max-w-xs'>
                <span className='text-muted-foreground'>
                  {t('goals.weeklyTargetSessions')}
                </span>
                <Input
                  type='number'
                  min='1'
                  max='100'
                  step='1'
                  value={gymWeekly}
                  onChange={(event) => setGymWeekly(event.target.value)}
                />
              </label>
              <p className='text-xs text-muted-foreground'>
                {t('goals.gymSourceHint')}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className='flex justify-end'>
          <Button onClick={() => void saveMain()}>
            <Save className='me-2 size-4' />
            {t('goals.saveTargets')}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('goals.weeklyShares')}</CardTitle>
            <CardDescription>{t('goals.weeklySharesHint')}</CardDescription>
          </CardHeader>
          <CardContent className='overflow-x-auto'>
            <table className='w-full min-w-150 text-sm'>
              <thead className='text-muted-foreground'>
                <tr className='border-b text-start'>
                  <th className='p-2 text-start font-medium'>
                    {t('goals.day')}
                  </th>
                  <th className='p-2 text-start font-medium'>
                    {t('goals.share')}
                  </th>
                  <th className='p-2 text-start font-medium'>
                    {t('goals.workActual')}
                  </th>
                  <th className='p-2 text-start font-medium'>
                    {t('goals.gymActual')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {weekDays.map((key) => (
                  <tr key={key} className='border-b last:border-0'>
                    <td className='p-2'>
                      {weekdayLabel(key, i18n.language)}
                      {key === today ? (
                        <Badge variant='outline' className='ms-2'>
                          {t('goals.today')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className='p-2 tabular-nums'>
                      {formatHoursMinutes(
                        (findGoal(goals, 'work_education', 'weekly')?.target ??
                          0) / 7
                      )}
                    </td>
                    <td className='p-2 tabular-nums'>
                      {formatHoursMinutes(combinedWeek[key] ?? 0)}
                    </td>
                    <td className='p-2 tabular-nums'>
                      {week?.gymByDay[key] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='mt-3 text-xs text-muted-foreground'>
              {t('goals.weeklyTotalHint')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <GraduationCap className='size-5' />
              {t('goals.educationSplit')}
            </CardTitle>
            <CardDescription>{t('goals.educationSplitHint')}</CardDescription>
          </CardHeader>
          <CardContent className='grid gap-3 sm:grid-cols-3'>
            {LEARNING_TRACKS.map((track) => (
              <div key={track} className='rounded-lg border p-3'>
                <p className='text-sm text-muted-foreground'>
                  {t(`learning.tracks.${track}`)}
                </p>
                <p className='text-lg font-semibold tabular-nums'>
                  {formatHoursMinutes(week?.educationByTrack[track] ?? 0)}
                </p>
              </div>
            ))}
            {week && Object.keys(week.educationByCourse).length ? (
              <div className='sm:col-span-3'>
                <p className='mb-2 text-sm font-medium'>
                  {t('goals.perCourse')}
                </p>
                <ul className='space-y-1 text-sm'>
                  {Object.entries(week.educationByCourse)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, seconds]) => (
                      <li
                        key={id}
                        className='flex justify-between gap-2 border-b py-1 last:border-0'
                      >
                        <span>{courseTitle(id)}</span>
                        <span className='tabular-nums'>
                          {formatHoursMinutes(seconds)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground sm:col-span-3'>
                {t('goals.noEducation')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Target className='size-5' />
              {t('goals.extraTitle')}
            </CardTitle>
            <CardDescription>{t('goals.extraHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-5'>
              <select
                aria-label={t('goals.extraType')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={extraAxis}
                onChange={(event) =>
                  setExtraAxis(
                    event.target.value as 'education_track' | 'project'
                  )
                }
              >
                <option value='education_track'>{t('goals.extraTrack')}</option>
                <option value='project'>{t('goals.extraProject')}</option>
              </select>
              {extraAxis === 'education_track' ? (
                <select
                  aria-label={t('goals.track')}
                  className='h-9 rounded-md border bg-background px-3 text-sm'
                  value={extraTrack}
                  onChange={(event) =>
                    setExtraTrack(event.target.value as LearningTrack)
                  }
                >
                  {LEARNING_TRACKS.map((track) => (
                    <option key={track} value={track}>
                      {t(`learning.tracks.${track}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label={t('goals.project')}
                  className='h-9 rounded-md border bg-background px-3 text-sm'
                  value={extraProject}
                  onChange={(event) => setExtraProject(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label={t('goals.periodLabel')}
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={extraPeriod}
                onChange={(event) =>
                  setExtraPeriod(event.target.value as 'daily' | 'weekly')
                }
              >
                <option value='daily'>{t('goals.period.daily')}</option>
                <option value='weekly'>{t('goals.period.weekly')}</option>
              </select>
              <Input
                type='number'
                min='0.25'
                step='0.25'
                aria-label={t('goals.extraTarget')}
                placeholder={t('goals.extraTarget')}
                value={extraTarget}
                onChange={(event) => setExtraTarget(event.target.value)}
              />
              <Button
                onClick={() => void saveExtra()}
                disabled={extraAxis === 'project' && !extraProject}
              >
                <Plus className='me-2 size-4' />
                {t('goals.addGoal')}
              </Button>
            </div>

            {optionalRows.length ? (
              <ul className='space-y-2'>
                {optionalRows.map(({ goal, progress }) => (
                  <li key={goal.id} className='rounded-lg border p-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div>
                        <p className='font-medium'>
                          {goal.axis === 'education_track'
                            ? t('goals.trackGoal', {
                                name: t(
                                  `learning.tracks.${goal.track ?? 'masters'}`
                                ),
                              })
                            : t('goals.projectGoal', {
                                name: projectTitle(goal.projectId ?? ''),
                              })}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {t(`goals.period.${goal.period}`)}
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <GoalStateBadge progress={progress} />
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() => void removeGoal(goal)}
                        >
                          <Trash2 className='size-4' />
                          <span className='sr-only'>{t('goals.delete')}</span>
                        </Button>
                      </div>
                    </div>
                    <div className='mt-2 space-y-2'>
                      <GoalNumbers progress={progress} unit='hours' />
                      <GoalProgressBar progress={progress} mode='status' />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('goals.noExtra')}
              </p>
            )}
          </CardContent>
        </Card>

        <p className='text-xs text-muted-foreground'>
          {t('goals.historyHint')}
        </p>
      </Main>
    </>
  )
}
