import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlarmClock, CalendarClock, Dumbbell, Flame, FolderGit2, GraduationCap, Scale, Share2, Wallet } from 'lucide-react'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  getAllWorkTasks,
  getBodyWeight,
  getDashboardDay,
  getFinanceEntries,
  getFinanceSettings,
  getMealLogs,
  getNewsItems,
  getPreviousDashboardNote,
  getStudyLogs,
  getWorkoutLogs,
  runStartupRollover,
  saveDashboardNote,
  type DashboardDayRecord,
  type NewsItem,
} from '@/services/db'
import { getEducationTasks, type EducationTask } from '@/services/education'
import { getEducationItems, type EducationItem } from '@/services/learning'
import { getCardioLogs } from '@/services/nutrition'
import { getSocialActivities } from '@/services/social'
import { getProjects, type Project } from '@/services/projects'
import { calculateFinanceTotals, type FinanceTotals } from '@/features/finance/finance-utils'
import { summarizeNutrition, type NutritionSummary } from '@/features/nutrition/nutrition-utils'
import { summarizeLearning, type LearningOverview } from '@/features/learning/learning-utils'
import { TasksOverview } from './tasks-overview'
import type { TimelineBlockRecord } from '@/types/timeline'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTimeValue } from '@/lib/time'

const emptyDay = (reference: Date): DashboardDayRecord => ({ dateKey: toDateKey(reference), wakeTime: '', breakfast: '', bagItems: [], commuteTime: '', note: '', updatedAt: new Date().toISOString() })

type DashboardSection = 'day' | 'finance' | 'nutrition' | 'learning' | 'tasks' | 'projects' | 'workout' | 'social' | 'news'

export function Dashboard() {
  const { t, i18n } = useTranslation()
  const [reference] = useState(() => new Date())
  const [day, setDay] = useState<DashboardDayRecord>(() => emptyDay(reference))
  const [previousNote, setPreviousNote] = useState<{ dateKey: string; note: string }>()
  const [noteSaveError, setNoteSaveError] = useState(false)
  const noteSaveSequence = useRef(0)
  const [finance, setFinance] = useState<FinanceTotals | null>(null)
  const [financeEntryCount, setFinanceEntryCount] = useState(0)
  const [nutrition, setNutrition] = useState<NutritionSummary | null>(null)
  const [learning, setLearning] = useState<LearningOverview | null>(null)
  const [educationItems, setEducationItems] = useState<EducationItem[]>([])
  const [educationTasks, setEducationTasks] = useState<EducationTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<TimelineBlockRecord[]>([])
  const [projectTasks, setProjectTasks] = useState(0)
  const [workoutSets, setWorkoutSets] = useState(0)
  const [currentWeight, setCurrentWeight] = useState<number | null>(null)
  const [socialPending, setSocialPending] = useState(0)
  const [news, setNews] = useState<NewsItem[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [failed, setFailed] = useState<Partial<Record<DashboardSection, boolean>>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const monthKey = toDateKey(reference).slice(0, 7)
    const load = async () => {
      // Overdue tasks are moved at startup; reading before that finishes would show stale dates.
      await runStartupRollover().catch(() => [])
      return Promise.allSettled([
        getDashboardDay(reference),
        getFinanceEntries(monthKey),
        getFinanceSettings(),
        getMealLogs(reference),
        getCardioLogs(reference),
        getStudyLogs(reference),
        getEducationItems(),
        getEducationTasks(),
        getProjects(),
        getAllWorkTasks(),
        getWorkoutLogs(reference),
        getBodyWeight(reference),
        getSocialActivities(),
        getNewsItems(),
        getPreviousDashboardNote(reference),
      ])
    }
    void load()
      .then(([saved, entries, settings, meals, cardio, studyLogs, items, studyTasks, projectList, workTasks, sets, weight, social, newsItems, previous]) => {
        if (!active) return
        if (saved.status === 'fulfilled' && saved.value) setDay(saved.value)
        if (previous.status === 'fulfilled' && !(saved.status === 'fulfilled' && saved.value?.note?.trim())) setPreviousNote(previous.value)
        if (entries.status === 'fulfilled' && settings.status === 'fulfilled') {
          setFinance(calculateFinanceTotals(entries.value, settings.value.savingsGoalBasisPoints))
          setFinanceEntryCount(entries.value.length)
        }
        if (meals.status === 'fulfilled' && cardio.status === 'fulfilled') setNutrition(summarizeNutrition(meals.value, cardio.value))
        if (studyLogs.status === 'fulfilled') setLearning(summarizeLearning(studyLogs.value))
        if (items.status === 'fulfilled') setEducationItems(items.value)
        if (studyTasks.status === 'fulfilled') setEducationTasks(studyTasks.value)
        if (projectList.status === 'fulfilled') setProjects(projectList.value)
        if (workTasks.status === 'fulfilled') {
          setTasks(workTasks.value)
          setProjectTasks(workTasks.value.filter((task) => task.projectId).length)
        }
        if (sets.status === 'fulfilled') setWorkoutSets(sets.value.length)
        if (weight.status === 'fulfilled') setCurrentWeight(weight.value?.weightKg ?? null)
        if (social.status === 'fulfilled') setSocialPending(social.value.filter((item) => item.status !== 'done').length)
        if (newsItems.status === 'fulfilled') setNews(newsItems.value.slice(0, 3))
        setFailed({
          day: saved.status === 'rejected',
          finance: entries.status === 'rejected' || settings.status === 'rejected',
          nutrition: meals.status === 'rejected' || cardio.status === 'rejected',
          learning: studyLogs.status === 'rejected' || items.status === 'rejected',
          tasks: workTasks.status === 'rejected' || studyTasks.status === 'rejected',
          projects: projectList.status === 'rejected' || workTasks.status === 'rejected',
          workout: sets.status === 'rejected' || weight.status === 'rejected',
          social: social.status === 'rejected',
          news: newsItems.status === 'rejected',
        })
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setFailed({ day: true, finance: true, nutrition: true, learning: true, tasks: true, projects: true, workout: true, social: true, news: true })
        setLoading(false)
      })
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [reference])

  const persistNote = (note: string) => {
    const sequence = ++noteSaveSequence.current
    setDay((current) => ({ ...current, note }))
    void saveDashboardNote(reference, note).then(
      () => {
        if (sequence === noteSaveSequence.current) setNoteSaveError(false)
      },
      () => {
        if (sequence === noteSaveSequence.current) setNoteSaveError(true)
      }
    )
  }

  /** Reloads both task lists from their own modules after a status change. */
  const reloadTasks = useCallback(async () => {
    const [workTasks, studyTasks] = await Promise.all([
      getAllWorkTasks(),
      getEducationTasks(),
    ])
    setTasks(workTasks)
    setEducationTasks(studyTasks)
    setProjectTasks(workTasks.filter((task) => task.projectId).length)
  }, [])

  const commuteMs = useMemo(() => {
    if (!day.commuteTime) return null
    const [h, m] = day.commuteTime.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.getTime() - now
  }, [day.commuteTime, now])

  const activeProjects = useMemo(() => projects.filter((project) => project.status === 'active' || project.status === 'planned'), [projects])

  const money = (amount: bigint | number) =>
    `${new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US').format(amount)} ${t('finance.toman')}`

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{t('dashboard.title')}</h2>
          <p className='text-muted-foreground'>{formatJalaliDateKey(toDateKey(new Date()))} · {t('dashboard.subtitle')}</p>
        </div>

        <div className='grid gap-4 xl:grid-cols-3'>
          <TasksOverview
            workTasks={tasks}
            educationTasks={educationTasks}
            educationItems={educationItems}
            projects={projects}
            now={now}
            loading={loading}
            loadError={Boolean(failed.tasks)}
            onChanged={reloadTasks}
          />

          <div className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Wallet className='size-5 text-emerald-600' />
                  {t('dashboard.finance')}
                </CardTitle>
                <CardDescription>{t('dashboard.localOnly')}</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
                ) : failed.finance ? (
                  <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
                ) : financeEntryCount === 0 ? (
                  <p className='text-sm text-muted-foreground'>{t('dashboard.noFinance')}</p>
                ) : finance ? (
                  <div className='space-y-3 text-sm'>
                    <div className='flex items-center justify-between'>
                      <span>{t('dashboard.monthIncome')}</span>
                      <strong>{money(finance.income)}</strong>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span>{t('dashboard.monthExpenses')}</span>
                      <strong>{money(finance.expenses)}</strong>
                    </div>
                    <div className='flex items-center justify-between border-t pt-3'>
                      <span>{t('dashboard.savingsGoal')}</span>
                      <strong>{money(finance.savingsGoal)}</strong>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span>{t('finance.actualSavings')}</span>
                      <strong>{money(finance.actualSavings)}</strong>
                    </div>
                  </div>
                ) : null}
                <a className='mt-3 inline-block text-sm text-primary underline' href='/finance'>{t('dashboard.openFinance')}</a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <AlarmClock className='size-5 text-amber-500' />
                  {t('dashboard.routine')}
                </CardTitle>
                <CardDescription>{t('dashboard.routineHint')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-2 text-sm'>
                {failed.day ? (
                  <p role='alert' className='text-destructive'>{t('dashboard.loadError')}</p>
                ) : day.wakeTime ? (
                  <p>{t('dashboard.wake')}: <strong>{formatClockTimeValue(day.wakeTime, i18n.language)}</strong></p>
                ) : (
                  <p className='text-muted-foreground'>{t('dashboard.noRoutine')}</p>
                )}
                {commuteMs !== null ? (
                  <p className='text-muted-foreground'>
                    {t('dashboard.departure')}: {formatClockTimeValue(day.commuteTime, i18n.language)} ·{' '}
                    {commuteMs > 0
                      ? `${Math.floor(commuteMs / 3600000)}:${String(Math.floor((commuteMs % 3600000) / 60000)).padStart(2, '0')} ${t('dashboard.remaining')}`
                      : t('dashboard.departureTime')}
                  </p>
                ) : null}
                <a className='inline-block text-sm text-primary underline' href='/golden-hour'>{t('dashboard.openRoutine')}</a>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <GraduationCap className='size-5 text-indigo-500' />
                {t('dashboard.learning')}
              </CardTitle>
              <CardDescription>{t('dashboard.learningHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.learning ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : learning && learning.sessions === 0 && educationItems.length === 0 ? (
                <p className='text-muted-foreground'>{t('dashboard.noLearning')}</p>
              ) : learning ? (
                <>
                  <div className='flex items-center justify-between'>
                    <span>{t('dashboard.learningTotal')}</span>
                    <strong>{learning.totalMinutes} {t('dashboard.minutes')}</strong>
                  </div>
                  {(['masters', 'university', 'course'] as const).map((track) => (
                    <div key={track} className='flex items-center justify-between text-muted-foreground'>
                      <span>{t(`learning.tracks.${track}`)}</span>
                      <span>{learning.byTrack[track]} {t('dashboard.minutes')}</span>
                    </div>
                  ))}
                </>
              ) : null}
              <a className='inline-block text-sm text-primary underline' href='/education'>{t('dashboard.openLearning')}</a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Flame className='size-5 text-orange-500' />
                {t('dashboard.nutrition')}
              </CardTitle>
              <CardDescription>{t('dashboard.nutritionHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.nutrition ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : nutrition && nutrition.intake === 0 && nutrition.burned === 0 ? (
                <p className='text-muted-foreground'>{t('dashboard.noNutrition')}</p>
              ) : nutrition ? (
                <>
                  <div className='flex items-center justify-between'>
                    <span>{t('nutrition.summary.intake')}</span>
                    <strong>{nutrition.intake} kcal</strong>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span>{t('nutrition.summary.burned')}</span>
                    <strong>{nutrition.burned} kcal</strong>
                  </div>
                  <div className='flex items-center justify-between border-t pt-2'>
                    <span>{t('nutrition.summary.net')}</span>
                    <strong>{nutrition.net} kcal</strong>
                  </div>
                </>
              ) : null}
              <a className='inline-block text-sm text-primary underline' href='/nutrition'>{t('dashboard.openNutrition')}</a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <FolderGit2 className='size-5 text-sky-600' />
                {t('dashboard.projects')}
              </CardTitle>
              <CardDescription>{t('dashboard.projectsHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.projects ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : activeProjects.length === 0 ? (
                <p className='text-muted-foreground'>{t('dashboard.noProjects')}</p>
              ) : (
                <>
                  <div className='flex items-center justify-between'>
                    <span>{t('dashboard.activeProjects')}</span>
                    <strong>{activeProjects.length}</strong>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span>{t('dashboard.linkedTasks')}</span>
                    <strong>{projectTasks}</strong>
                  </div>
                  <ul className='space-y-1 text-muted-foreground'>
                    {activeProjects.slice(0, 3).map((project) => (
                      <li key={project.id}>
                        {project.title} · {t(`projects.statuses.${project.status}`)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <a className='inline-block text-sm text-primary underline' href='/projects'>{t('dashboard.openProjects')}</a>
            </CardContent>
          </Card>
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Dumbbell className='size-5' />
                {t('dashboard.workout')}
              </CardTitle>
              <CardDescription>{t('dashboard.workoutHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.workout ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : workoutSets === 0 && currentWeight === null ? (
                <p className='text-muted-foreground'>{t('dashboard.noWorkout')}</p>
              ) : (
                <>
                  <p>{t('health.todaySets', { count: workoutSets })}</p>
                  {currentWeight !== null ? (
                    <p className='flex items-center gap-2'>
                      <Scale className='size-4' />
                      {t('health.todayWeight')}: {currentWeight} kg
                    </p>
                  ) : null}
                </>
              )}
              <a className='inline-block text-sm text-primary underline' href='/gym'>{t('dashboard.openWorkout')}</a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Share2 className='size-5' />
                {t('dashboard.social')}
              </CardTitle>
              <CardDescription>{t('dashboard.socialHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.social ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : socialPending === 0 ? (
                <p className='text-muted-foreground'>{t('dashboard.noSocial')}</p>
              ) : (
                <p>{t('dashboard.pendingSocial', { count: socialPending })}</p>
              )}
              <a className='inline-block text-sm text-primary underline' href='/social'>{t('dashboard.openSocial')}</a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <CalendarClock className='size-5' />
                {t('dashboard.news')}
              </CardTitle>
              <CardDescription>{t('dashboard.newsHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {loading ? (
                <p role='status' className='text-sm text-muted-foreground'>{t('dashboard.loading')}</p>
              ) : failed.news ? (
                <p role='alert' className='text-sm text-destructive'>{t('dashboard.loadError')}</p>
              ) : news.length === 0 ? (
                <p className='text-muted-foreground'>{t('dashboard.noNews')}</p>
              ) : (
                <ul className='space-y-1'>
                  {news.map((item) => (
                    <li key={item.id} className='truncate'>
                      {item.title}
                    </li>
                  ))}
                </ul>
              )}
              <a className='inline-block text-sm text-primary underline' href='/news'>{t('dashboard.openNews')}</a>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.quickNote')}</CardTitle>
            <CardDescription>{t('dashboard.noteHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            <Textarea value={day.note} disabled={loading || failed.day} onChange={(event) => persistNote(event.target.value)} placeholder={t('dashboard.notePlaceholder')} />
            {failed.day ? (
              <p role='alert' className='text-sm text-destructive'>{t('dashboard.noteLoadError')}</p>
            ) : null}
            {noteSaveError ? (
              <p role='alert' className='text-sm text-destructive'>{t('dashboard.noteSaveError')}</p>
            ) : null}
            {previousNote ? (
              <div className='rounded-md border bg-muted/40 p-3 text-sm'>
                <p className='text-xs text-muted-foreground'>{t('dashboard.previousNote', { date: formatJalaliDateKey(previousNote.dateKey) })}</p>
                <p className='mt-1 whitespace-pre-wrap'>{previousNote.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
