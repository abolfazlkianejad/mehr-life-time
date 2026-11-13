import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getRouteApi } from '@tanstack/react-router'
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  GraduationCap,
  ListChecks,
  ListTodo,
  MessageSquare,
  Pause,
  Timer,
  TrendingUp,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  educationElapsedSeconds,
  finishEducationTaskTimer,
  getEducationReports,
  getEducationTasks,
  pauseEducationTaskTimer,
  type EducationReport,
  type EducationTask,
} from '@/services/education'
import { getEducationItems, type EducationItem } from '@/services/learning'
import { CoursePanel } from './course-panel'
import { ReportsPanel } from './reports-panel'
import { TaskPanel } from './task-panel'
import { formatStudyDuration, summarizeEducation } from './education-utils'

const EDUCATION_SYNC_CHANNEL = 'mehr-education-sync'

const route = getRouteApi('/_authenticated/education/')

/** Header + icon + value card used by the compact education dashboard. */
function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: ReactNode
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardDescription className='flex items-center gap-2'>
          {icon}
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className='text-xl font-semibold tabular-nums'>{value}</CardContent>
    </Card>
  )
}

export function LearningPage() {
  const { t } = useTranslation()
  const { tab: initialTab } = route.useSearch()
  const [items, setItems] = useState<EducationItem[]>([])
  const [tasks, setTasks] = useState<EducationTask[]>([])
  const [reports, setReports] = useState<EducationReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [tab, setTab] = useState<string>(initialTab ?? 'masters')
  const syncChannel = useRef<BroadcastChannel | null>(null)
  // Only the newest load may update the list, so a slow stale read can never
  // hide a course that was just saved.
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadIdRef.current
    const [savedItems, savedTasks, savedReports] = await Promise.all([
      getEducationItems(),
      getEducationTasks(),
      getEducationReports(),
    ])
    if (requestId !== loadIdRef.current) return
    setItems(savedItems)
    setTasks(savedTasks)
    setReports(savedReports)
  }, [])

  const refresh = useCallback(async () => {
    try {
      await load()
      setError('')
      setErrorDetail('')
    } catch (loadError) {
      setError(t('learning.errors.load'))
      setErrorDetail(
        loadError instanceof Error && loadError.message ? loadError.message : ''
      )
    }
  }, [load, t])

  /** Reload, then tell other tabs to do the same. */
  const changed = useCallback(async () => {
    await refresh()
    syncChannel.current?.postMessage('education-changed')
  }, [refresh])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader updates state after an async read
    void refresh().finally(() => {
      if (active) setLoading(false)
    })
    const ticker = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      active = false
      window.clearInterval(ticker)
    }
  }, [refresh])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(EDUCATION_SYNC_CHANNEL)
    syncChannel.current = channel
    const onMessage = () => {
      void refresh()
    }
    const onFocus = () => {
      void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    channel.addEventListener('message', onMessage)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
      syncChannel.current = null
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const summary = useMemo(
    () => summarizeEducation(tasks, items, now),
    [tasks, items, now]
  )
  const activeTask = summary.activeTask

  const actOnActive = async (action: 'pause' | 'finish') => {
    if (!activeTask) return
    setError('')
    try {
      if (action === 'pause') await pauseEducationTaskTimer(activeTask.id)
      else await finishEducationTaskTimer(activeTask.id)
      await changed()
    } catch {
      setError(t('learning.errors.timer'))
    }
  }

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('learning.title')}</h2>
          <p className='text-muted-foreground'>{t('learning.subtitle')}</p>
        </div>

        {error ? (
          <div role='alert' className='space-y-1 text-sm text-destructive'>
            <div className='flex flex-wrap items-center gap-2'>
              <span>{error}</span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  setLoading(true)
                  void refresh().finally(() => setLoading(false))
                }}
              >
                {t('learning.errors.retry')}
              </Button>
            </div>
            {errorDetail ? (
              <p dir='ltr' className='text-xs text-muted-foreground'>
                {errorDetail}
              </p>
            ) : null}
          </div>
        ) : null}

        {activeTask ? (
          <Card className='border-primary'>
            <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-6'>
              <div className='min-w-0'>
                <p className='text-xs font-medium text-muted-foreground'>
                  {t('learning.running.title')}
                </p>
                <p className='truncate font-medium'>{activeTask.title}</p>
                <p className='text-xs text-muted-foreground'>
                  {t(`learning.tracks.${activeTask.track}`)}
                  {activeTask.courseId
                    ? ` · ${items.find((item) => item.id === activeTask.courseId)?.title ?? ''}`
                    : ''}
                </p>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge className='font-mono tabular-nums'>
                  <Timer className='me-1 size-3.5' />
                  {formatStudyDuration(educationElapsedSeconds(activeTask, now))}
                </Badge>
                <Button size='sm' variant='outline' onClick={() => void actOnActive('pause')}>
                  <Pause className='me-2 size-4' />
                  {t('learning.running.pause')}
                </Button>
                <Button size='sm' variant='secondary' onClick={() => void actOnActive('finish')}>
                  <Check className='me-2 size-4' />
                  {t('learning.running.finish')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
          <SummaryCard
            label={t('learning.dashboard.todayTasks')}
            value={summary.todayTasks}
            icon={<ListTodo className='size-4' />}
          />
          <SummaryCard
            label={t('learning.dashboard.completedToday')}
            value={summary.completedToday}
            icon={<CheckCircle2 className='size-4' />}
          />
          <SummaryCard
            label={t('learning.dashboard.remainingToday')}
            value={summary.remainingToday}
            icon={<ListChecks className='size-4' />}
          />
          <SummaryCard
            label={t('learning.dashboard.studyToday')}
            value={formatStudyDuration(summary.studyTodaySeconds)}
            icon={<Clock3 className='size-4' />}
          />
          <SummaryCard
            label={t('learning.dashboard.studyWeek')}
            value={formatStudyDuration(summary.studyWeekSeconds)}
            icon={<TrendingUp className='size-4' />}
          />
          <SummaryCard
            label={t('learning.dashboard.activeCourses')}
            value={summary.activeCourses}
            icon={<BookOpen className='size-4' />}
          />
        </div>

        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('learning.loading')}
          </p>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className='grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5'>
              <TabsTrigger value='masters' className='gap-2'>
                <GraduationCap className='size-4' />
                {t('learning.tabs.masters')}
              </TabsTrigger>
              <TabsTrigger value='university' className='gap-2'>
                <GraduationCap className='size-4' />
                {t('learning.tabs.university')}
              </TabsTrigger>
              <TabsTrigger value='course' className='gap-2'>
                <GraduationCap className='size-4' />
                {t('learning.tabs.course')}
              </TabsTrigger>
              <TabsTrigger value='tasks' className='gap-2'>
                <ListTodo className='size-4' />
                {t('learning.tabs.tasks')}
              </TabsTrigger>
              <TabsTrigger value='reports' className='gap-2'>
                <MessageSquare className='size-4' />
                {t('learning.tabs.reports')}
              </TabsTrigger>
            </TabsList>

            {(['masters', 'university', 'course'] as const).map((track) => (
              <TabsContent key={track} value={track} className='mt-4'>
                <CoursePanel
                  track={track}
                  items={items}
                  tasks={tasks}
                  now={now}
                  onChanged={changed}
                />
              </TabsContent>
            ))}

            <TabsContent value='tasks' className='mt-4'>
              <TaskPanel
                items={items}
                tasks={tasks}
                reports={reports}
                now={now}
                onChanged={changed}
                onError={setError}
              />
            </TabsContent>

            <TabsContent value='reports' className='mt-4'>
              <ReportsPanel reports={reports} onChanged={changed} onError={setError} />
            </TabsContent>
          </Tabs>
        )}
      </Main>
    </>
  )
}
