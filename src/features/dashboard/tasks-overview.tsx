import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GraduationCap,
  ListTodo,
  Pause,
  Play,
  Search,
  Timer,
} from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatJalaliDateKey } from '@/lib/jalali'
import { toDateKey } from '@/lib/date-key'
import {
  completeWorkTask,
  pauseWorkTaskTimer,
  startWorkTaskTimer,
} from '@/services/db'
import {
  educationElapsedSeconds,
  finishEducationTaskTimer,
  pauseEducationTaskTimer,
  startEducationTaskTimer,
  type EducationTask,
} from '@/services/education'
import type { EducationItem } from '@/services/learning'
import type { Project } from '@/services/projects'
import type { TimelineBlockRecord } from '@/types/timeline'
import { formatDuration, taskElapsedSeconds } from '@/features/tasks/work-task-utils'
import {
  buildUnifiedTasks,
  filterUnifiedTasks,
  sortUnifiedTasks,
  summarizeUnifiedTasks,
  type UnifiedTask,
  type UnifiedTaskFilters,
  type UnifiedTaskSort,
} from './unified-tasks'

const PAGE_SIZE = 8

interface TasksOverviewProps {
  workTasks: TimelineBlockRecord[]
  educationTasks: EducationTask[]
  educationItems: EducationItem[]
  projects: Project[]
  now: number
  loading: boolean
  loadError: boolean
  /** Reloads both task lists from their own modules after a status change. */
  onChanged: () => Promise<void>
}

export function TasksOverview({
  workTasks,
  educationTasks,
  educationItems,
  projects,
  now,
  loading,
  loadError,
  onChanged,
}: TasksOverviewProps) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<UnifiedTaskFilters>({
    source: 'all',
    status: 'all',
    range: 'all',
    query: '',
  })
  const [sort, setSort] = useState<UnifiedTaskSort>('smart')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const todayKey = useMemo(() => toDateKey(new Date()), [])

  const unified = useMemo(
    () => buildUnifiedTasks(workTasks, educationTasks),
    [workTasks, educationTasks]
  )
  const filtered = useMemo(
    () => sortUnifiedTasks(filterUnifiedTasks(unified, filters, todayKey), sort),
    [unified, filters, sort, todayKey]
  )
  const counts = useMemo(() => summarizeUnifiedTasks(unified), [unified])

  const runningWork = unified.some((task) => task.source === 'work' && task.timerStartedAt)
  const runningEducation = unified.some(
    (task) => task.source === 'education' && task.timerStartedAt
  )

  const applyFilters = (patch: Partial<UnifiedTaskFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setVisible(PAGE_SIZE)
  }

  const act = async (task: UnifiedTask, action: 'start' | 'pause' | 'complete') => {
    setActionError('')
    try {
      if (task.source === 'work') {
        if (action === 'start') await startWorkTaskTimer(task.id)
        else if (action === 'pause') await pauseWorkTaskTimer(task.id)
        else await completeWorkTask(task.id)
      } else {
        if (action === 'start') await startEducationTaskTimer(task.id)
        else if (action === 'pause') await pauseEducationTaskTimer(task.id)
        else await finishEducationTaskTimer(task.id)
      }
      await onChanged()
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : ''
      setActionError(detail || t('dashboard.tasksActionError'))
    }
  }

  const trackedSeconds = (task: UnifiedTask): number => {
    if (task.source === 'work') {
      return taskElapsedSeconds(
        { elapsedSeconds: task.elapsedSeconds ?? 0, timerStartedAt: task.timerStartedAt },
        now
      )
    }
    return educationElapsedSeconds(
      { actualSeconds: task.elapsedSeconds ?? 0, timerStartedAt: task.timerStartedAt },
      now
    )
  }

  const priorityVariant = (priority: UnifiedTask['priority']) =>
    priority === 'urgent' ? 'destructive' : priority === 'high' ? 'default' : 'outline'

  const statusLabel = (task: UnifiedTask) =>
    task.source === 'work'
      ? t(`tasks.status.${task.status}`)
      : t(`learning.taskStatuses.${task.status}`)

  const courseTitle = (task: UnifiedTask) =>
    task.courseId
      ? educationItems.find((item) => item.id === task.courseId)?.title ?? ''
      : ''

  const projectTitle = (task: UnifiedTask) =>
    task.projectId ? projects.find((project) => project.id === task.projectId)?.title ?? '' : ''

  const moduleHref = (task: UnifiedTask) =>
    task.source === 'work' ? '/tasks' : '/education?tab=tasks'

  return (
    <Card className='xl:col-span-2'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          <ListTodo className='size-5 text-primary' />
          {t('dashboard.tasks')}
          <span className='ms-auto flex flex-wrap gap-1.5 text-xs font-normal text-muted-foreground'>
            <Badge variant='outline'>{t('dashboard.tasksTotal', { count: counts.total })}</Badge>
            <Badge variant='secondary'>{t('dashboard.tasksCompleted', { count: counts.completed })}</Badge>
            <Badge variant='outline'>{t('dashboard.tasksRemaining', { count: counts.remaining })}</Badge>
          </span>
        </CardTitle>
        <CardDescription>{t('dashboard.tasksHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('dashboard.loading')}
          </p>
        ) : loadError ? (
          <p role='alert' className='text-sm text-destructive'>
            {t('dashboard.loadError')}
          </p>
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                value={filters.source}
                onValueChange={(value) =>
                  applyFilters({ source: value as UnifiedTaskFilters['source'] })
                }
              >
                <SelectTrigger aria-label={t('dashboard.tasksSourceLabel')} className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('dashboard.tasksSourceAll')}</SelectItem>
                  <SelectItem value='work'>{t('dashboard.tasksSourceWork')}</SelectItem>
                  <SelectItem value='education'>{t('dashboard.tasksSourceEducation')}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  applyFilters({ status: value as UnifiedTaskFilters['status'] })
                }
              >
                <SelectTrigger aria-label={t('dashboard.tasksStatusLabel')} className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('dashboard.tasksStatusAll')}</SelectItem>
                  <SelectItem value='open'>{t('dashboard.tasksStatusOpen')}</SelectItem>
                  <SelectItem value='active'>{t('dashboard.tasksStatusActive')}</SelectItem>
                  <SelectItem value='done'>{t('dashboard.tasksStatusDone')}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.range}
                onValueChange={(value) =>
                  applyFilters({ range: value as UnifiedTaskFilters['range'] })
                }
              >
                <SelectTrigger aria-label={t('dashboard.tasksRangeLabel')} className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('dashboard.tasksRangeAll')}</SelectItem>
                  <SelectItem value='past'>{t('dashboard.tasksRangePast')}</SelectItem>
                  <SelectItem value='today'>{t('dashboard.tasksRangeToday')}</SelectItem>
                  <SelectItem value='upcoming'>{t('dashboard.tasksRangeUpcoming')}</SelectItem>
                </SelectContent>
              </Select>
              <div className='relative min-w-44 flex-1'>
                <Search className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={filters.query}
                  onChange={(event) => applyFilters({ query: event.target.value })}
                  aria-label={t('dashboard.tasksSearch')}
                  placeholder={t('dashboard.tasksSearch')}
                  className='h-9 ps-9'
                />
              </div>
              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(value as UnifiedTaskSort)
                  setVisible(PAGE_SIZE)
                }}
              >
                <SelectTrigger aria-label={t('dashboard.tasksSortLabel')} className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='smart'>{t('dashboard.tasksSortSmart')}</SelectItem>
                  <SelectItem value='priority'>{t('dashboard.tasksSortPriority')}</SelectItem>
                  <SelectItem value='date'>{t('dashboard.tasksSortDate')}</SelectItem>
                  <SelectItem value='time'>{t('dashboard.tasksSortTime')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {actionError ? (
              <p role='alert' className='text-sm text-destructive'>
                {t('dashboard.tasksActionError')}
                <span dir='ltr' className='ms-2 text-xs text-muted-foreground'>
                  {actionError}
                </span>
              </p>
            ) : null}

            {unified.length === 0 ? (
              <p className='text-sm text-muted-foreground'>{t('dashboard.tasksEmptyAll')}</p>
            ) : filtered.length === 0 ? (
              <p className='text-sm text-muted-foreground'>{t('dashboard.tasksEmpty')}</p>
            ) : (
              <>
                <ul className='space-y-2'>
                  {filtered.slice(0, visible).map((task) => {
                    const running = Boolean(task.timerStartedAt)
                    const tracked = trackedSeconds(task)
                    const sourceBlocked =
                      task.source === 'work' ? runningWork : runningEducation
                    return (
                      <li key={task.key} className='rounded-lg border'>
                        <div className='flex flex-wrap items-center justify-between gap-3 p-3'>
                          <button
                            type='button'
                            onClick={() =>
                              setExpanded((current) => (current === task.key ? null : task.key))
                            }
                            aria-expanded={expanded === task.key}
                            className='flex min-w-0 flex-1 flex-col items-start gap-1.5 text-start'
                          >
                            <span className='flex flex-wrap items-center gap-1.5'>
                              <span className='font-medium'>{task.title}</span>
                              <Badge variant='outline' className='gap-1'>
                                {task.source === 'work' ? (
                                  <Briefcase className='size-3' />
                                ) : (
                                  <GraduationCap className='size-3' />
                                )}
                                {t(
                                  task.source === 'work'
                                    ? 'dashboard.tasksTypeWork'
                                    : 'dashboard.tasksTypeEducation'
                                )}
                              </Badge>
                              <Badge variant={priorityVariant(task.priority)}>
                                {t(`tasks.priority.${task.priority}`)}
                              </Badge>
                              <Badge variant={task.bucket === 'done' ? 'secondary' : 'outline'}>
                                {statusLabel(task)}
                              </Badge>
                            </span>
                            <span className='text-xs text-muted-foreground'>
                              {formatJalaliDateKey(task.dateKey)} · {task.time} ·{' '}
                              {task.estimatedMinutes} {t('dashboard.minutes')}
                              {task.track
                                ? ` · ${t(`learning.tracks.${task.track}`)}`
                                : null}
                              {task.source === 'work' && task.isCompanyWork === false
                                ? ` · ${t('tasks.freelance')}`
                                : null}
                            </span>
                          </button>
                          <div className='flex items-center gap-2'>
                            {task.elapsedSeconds !== undefined || running ? (
                              <Badge variant='secondary' className='font-mono tabular-nums'>
                                <Timer className='me-1 size-3.5' />
                                {formatDuration(tracked)}
                              </Badge>
                            ) : null}
                            {task.bucket !== 'done' ? (
                              <>
                                {running ? (
                                  <Button
                                    size='icon'
                                    variant='outline'
                                    aria-label={t('dashboard.pause')}
                                    onClick={() => void act(task, 'pause')}
                                  >
                                    <Pause className='size-4' />
                                  </Button>
                                ) : (
                                  <Button
                                    size='icon'
                                    variant='outline'
                                    aria-label={t('dashboard.start')}
                                    disabled={sourceBlocked}
                                    onClick={() => void act(task, 'start')}
                                  >
                                    <Play className='size-4' />
                                  </Button>
                                )}
                                <Button
                                  size='icon'
                                  aria-label={t('dashboard.complete')}
                                  onClick={() => void act(task, 'complete')}
                                >
                                  <Check className='size-4' />
                                </Button>
                              </>
                            ) : null}
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={t('dashboard.tasksDetails')}
                              onClick={() =>
                                setExpanded((current) => (current === task.key ? null : task.key))
                              }
                            >
                              {expanded === task.key ? (
                                <ChevronUp className='size-4' />
                              ) : (
                                <ChevronDown className='size-4' />
                              )}
                            </Button>
                          </div>
                        </div>
                        {expanded === task.key ? (
                          <div className='space-y-1.5 border-t px-3 py-2 text-sm'>
                            {task.source === 'education' && task.description ? (
                              <p className='text-muted-foreground'>{task.description}</p>
                            ) : null}
                            {task.source === 'work' && task.notes ? (
                              <p className='text-muted-foreground'>{task.notes}</p>
                            ) : null}
                            {task.courseId && courseTitle(task) ? (
                              <p>
                                {t('learning.paths.name')}: {courseTitle(task)}
                              </p>
                            ) : null}
                            {task.projectId && projectTitle(task) ? (
                              <p>
                                {t('dashboard.projects')}: {projectTitle(task)}
                              </p>
                            ) : null}
                            {task.elapsedSeconds !== undefined || running ? (
                              <p>
                                {t('dashboard.tasksStudied')}:{' '}
                                <span className='font-mono tabular-nums'>
                                  {formatDuration(tracked)}
                                </span>
                              </p>
                            ) : null}
                            <a
                              href={moduleHref(task)}
                              className='inline-flex items-center gap-1 text-xs text-primary underline'
                            >
                              <ExternalLink className='size-3.5' />
                              {t('dashboard.tasksOpenModule')}
                            </a>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
                <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
                  <span>
                    {t('dashboard.tasksShowing', {
                      shown: Math.min(visible, filtered.length),
                      total: filtered.length,
                    })}
                  </span>
                  {visible < filtered.length ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setVisible((current) => current + PAGE_SIZE)}
                    >
                      {t('dashboard.tasksShowMore')}
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
