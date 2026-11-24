import { useMemo, useState } from 'react'
import type { TaskPriority, TimelineBlockRecord } from '@/types/timeline'
import {
  Briefcase,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GraduationCap,
  ListTodo,
  Pause,
  Play,
  RotateCcw,
  Search,
  Timer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatJalaliDateKey } from '@/lib/jalali'
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
import {
  finishGymSessionTimer,
  pauseGymSessionTimer,
  startGymSessionTimer,
  startPlannedGymSession,
} from '@/services/gym'
import type { EducationItem } from '@/services/learning'
import type { Project } from '@/services/projects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { TaskDescription } from '@/features/tasks/components/task-description'
import {
  formatDuration,
  taskElapsedSeconds,
} from '@/features/tasks/work-task-utils'
import type { ExerciseActivity } from './exercise-activities'
import { ExerciseCard, type ExerciseAction } from './exercise-card'
import {
  buildUnifiedTasks,
  filterUnifiedTasks,
  sortUnifiedTasks,
  summarizeUnifiedTasks,
  DEFAULT_UNIFIED_TASK_FILTERS,
  type UnifiedTask,
  type UnifiedTaskFilters,
  type UnifiedTaskSort,
} from './unified-tasks'

const PAGE_SIZE = 8

const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

interface TasksOverviewProps {
  workTasks: TimelineBlockRecord[]
  educationTasks: EducationTask[]
  educationItems: EducationItem[]
  projects: Project[]
  /** Exercise activities already restricted to the selected date. */
  exerciseActivities: ExerciseActivity[]
  now: number
  loading: boolean
  loadError: boolean
  /** Exact local day (`yyyy-MM-dd`) the dashboard shows, chosen by its date field. */
  dateKey: string
  /** Receives the selected Jalali day as a stored Gregorian day key. */
  onDateChange: (dateKey: string) => void
  /** Reloads both task lists from their own modules after a status change. */
  onChanged: () => Promise<void>
}

export function TasksOverview({
  workTasks,
  educationTasks,
  educationItems,
  projects,
  exerciseActivities,
  now,
  loading,
  loadError,
  dateKey,
  onDateChange,
  onChanged,
}: TasksOverviewProps) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<UnifiedTaskFilters>(
    DEFAULT_UNIFIED_TASK_FILTERS
  )
  const [sort, setSort] = useState<UnifiedTaskSort>('smart')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [descriptionOpen, setDescriptionOpen] = useState<Set<string>>(
    () => new Set()
  )
  const [actionError, setActionError] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [exercisePendingKey, setExercisePendingKey] = useState<string | null>(
    null
  )

  const unified = useMemo(
    () => buildUnifiedTasks(workTasks, educationTasks),
    [workTasks, educationTasks]
  )
  const filtered = useMemo(
    () =>
      sortUnifiedTasks(
        filterUnifiedTasks(unified, { ...filters, dateKey }),
        sort
      ),
    [unified, filters, sort, dateKey]
  )
  const counts = useMemo(
    () =>
      summarizeUnifiedTasks(
        filterUnifiedTasks(unified, { ...filters, dateKey })
      ),
    [unified, filters, dateKey]
  )

  const runningWork = unified.some(
    (task) => task.source === 'work' && task.timerStartedAt
  )
  const runningGym = exerciseActivities.some(
    (activity) => activity.status === 'running'
  )
  const hasActiveFilters =
    filters.source !== 'all' ||
    filters.status !== 'all' ||
    filters.priority !== 'all' ||
    filters.projectId !== 'all' ||
    filters.query.trim() !== ''

  const applyFilters = (patch: Partial<UnifiedTaskFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setVisible(PAGE_SIZE)
  }

  const chooseDate = (nextDateKey: string) => {
    onDateChange(nextDateKey)
    setVisible(PAGE_SIZE)
  }

  const clearFilters = () => {
    setFilters(DEFAULT_UNIFIED_TASK_FILTERS)
    setVisible(PAGE_SIZE)
  }

  const toggleDescription = (key: string) => {
    setDescriptionOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const act = async (
    task: UnifiedTask,
    action: 'start' | 'pause' | 'complete'
  ) => {
    if (pendingKey) return
    setActionError('')
    setPendingKey(task.key)
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
    } finally {
      setPendingKey(null)
    }
  }

  /** Every gym write happens only on an explicit button press. */
  const actOnExercise = async (
    activity: ExerciseActivity,
    action: ExerciseAction
  ) => {
    if (exercisePendingKey) return
    setActionError('')
    setExercisePendingKey(activity.key)
    try {
      const session = activity.session
      if (action === 'start') {
        if (session) await startGymSessionTimer(session.id)
        else {
          await startPlannedGymSession(
            activity.dateKey,
            activity.title,
            activity.plannedMinutes
          )
        }
      } else if (session && action === 'pause') {
        await pauseGymSessionTimer(session.id)
      } else if (session && action === 'finish') {
        await finishGymSessionTimer(session.id)
      }
      await onChanged()
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : ''
      setActionError(detail || t('dashboard.exerciseActionError'))
    } finally {
      setExercisePendingKey(null)
    }
  }

  const trackedSeconds = (task: UnifiedTask): number => {
    if (task.source === 'work') {
      return taskElapsedSeconds(
        {
          elapsedSeconds: task.elapsedSeconds ?? 0,
          timerStartedAt: task.timerStartedAt,
        },
        now
      )
    }
    return educationElapsedSeconds(
      {
        actualSeconds: task.elapsedSeconds ?? 0,
        timerStartedAt: task.timerStartedAt,
      },
      now
    )
  }

  const priorityVariant = (priority: UnifiedTask['priority']) =>
    priority === 'urgent'
      ? 'destructive'
      : priority === 'high'
        ? 'default'
        : 'outline'

  const statusLabel = (task: UnifiedTask) =>
    task.source === 'work'
      ? t(`tasks.status.${task.status}`)
      : t(`learning.taskStatuses.${task.status}`)

  const courseTitle = (task: UnifiedTask) =>
    task.courseId
      ? (educationItems.find((item) => item.id === task.courseId)?.title ?? '')
      : ''

  const projectTitle = (task: UnifiedTask) =>
    task.projectId
      ? (projects.find((project) => project.id === task.projectId)?.title ?? '')
      : ''

  const moduleHref = (task: UnifiedTask) =>
    task.source === 'work' ? '/tasks' : '/education?tab=tasks'

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          <ListTodo className='size-5 text-primary' />
          {t('dashboard.tasks')}
          <span className='ms-auto flex flex-wrap gap-1.5 text-xs font-normal text-muted-foreground'>
            <Badge variant='outline'>
              {t('dashboard.tasksTotal', { count: counts.total })}
            </Badge>
            <Badge variant='secondary'>
              {t('dashboard.tasksCompleted', { count: counts.completed })}
            </Badge>
            <Badge variant='outline'>
              {t('dashboard.tasksRemaining', { count: counts.remaining })}
            </Badge>
          </span>
        </CardTitle>
        <CardDescription>{t('dashboard.tasksHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
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
            {/* Date is the primary filter: one Jalali field, no preset buttons. */}
            <section
              aria-label={t('dashboard.tasksDateLabel')}
              className='rounded-lg border bg-muted/30 p-3'
            >
              <label className='block space-y-1.5 text-sm sm:max-w-xs'>
                <span className='flex items-center gap-1.5 font-medium'>
                  <CalendarDays className='size-4 text-primary' />
                  {t('dashboard.tasksSelectedDate')}
                </span>
                <JalaliDatePicker
                  value={dateKey}
                  onChange={chooseDate}
                  ariaLabel={t('dashboard.tasksSelectedDate')}
                  className='h-9'
                />
              </label>
            </section>

            <div className='flex flex-wrap items-center gap-2'>
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  applyFilters({
                    status: value as UnifiedTaskFilters['status'],
                  })
                }
              >
                <SelectTrigger
                  aria-label={t('dashboard.tasksStatusLabel')}
                  className='h-9'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>
                    {t('dashboard.tasksStatusAll')}
                  </SelectItem>
                  <SelectItem value='open'>
                    {t('dashboard.tasksStatusOpen')}
                  </SelectItem>
                  <SelectItem value='active'>
                    {t('dashboard.tasksStatusActive')}
                  </SelectItem>
                  <SelectItem value='paused'>
                    {t('dashboard.tasksStatusPaused')}
                  </SelectItem>
                  <SelectItem value='done'>
                    {t('dashboard.tasksStatusDone')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.priority}
                onValueChange={(value) =>
                  applyFilters({ priority: value as 'all' | TaskPriority })
                }
              >
                <SelectTrigger
                  aria-label={t('dashboard.tasksPriorityLabel')}
                  className='h-9'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>
                    {t('dashboard.tasksPriorityAll')}
                  </SelectItem>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {t(`tasks.priority.${priority}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projects.length ? (
                <Select
                  value={filters.projectId}
                  onValueChange={(value) => applyFilters({ projectId: value })}
                >
                  <SelectTrigger
                    aria-label={t('dashboard.tasksProjectLabel')}
                    className='h-9'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>
                      {t('dashboard.tasksProjectAll')}
                    </SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Select
                value={filters.source}
                onValueChange={(value) =>
                  applyFilters({
                    source: value as UnifiedTaskFilters['source'],
                  })
                }
              >
                <SelectTrigger
                  aria-label={t('dashboard.tasksSourceLabel')}
                  className='h-9'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>
                    {t('dashboard.tasksSourceAll')}
                  </SelectItem>
                  <SelectItem value='work'>
                    {t('dashboard.tasksSourceWork')}
                  </SelectItem>
                  <SelectItem value='education'>
                    {t('dashboard.tasksSourceEducation')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(value as UnifiedTaskSort)
                  setVisible(PAGE_SIZE)
                }}
              >
                <SelectTrigger
                  aria-label={t('dashboard.tasksSortLabel')}
                  className='h-9'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='smart'>
                    {t('dashboard.tasksSortSmart')}
                  </SelectItem>
                  <SelectItem value='priority'>
                    {t('dashboard.tasksSortPriority')}
                  </SelectItem>
                  <SelectItem value='date'>
                    {t('dashboard.tasksSortDate')}
                  </SelectItem>
                  <SelectItem value='time'>
                    {t('dashboard.tasksSortTime')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className='relative min-w-44 flex-1'>
                <Search className='absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={filters.query}
                  onChange={(event) =>
                    applyFilters({ query: event.target.value })
                  }
                  aria-label={t('dashboard.tasksSearch')}
                  placeholder={t('dashboard.tasksSearch')}
                  className='h-9 ps-9'
                />
              </div>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={clearFilters}
                disabled={!hasActiveFilters}
              >
                <RotateCcw className='me-1.5 size-4' />
                {t('dashboard.tasksClearFilters')}
              </Button>
            </div>

            {actionError ? (
              <p role='alert' className='text-sm text-destructive'>
                {t('dashboard.tasksActionError')}
                <span dir='ltr' className='ms-2 text-xs text-muted-foreground'>
                  {actionError}
                </span>
              </p>
            ) : null}

            {unified.length === 0 && exerciseActivities.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('dashboard.tasksEmptyAll')}
              </p>
            ) : null}
            {unified.length > 0 && filtered.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('dashboard.tasksEmpty')}
              </p>
            ) : null}
            {exerciseActivities.length || filtered.length ? (
              <>
                <ul className='space-y-2'>
                  {exerciseActivities.map((activity) => (
                    <ExerciseCard
                      key={activity.key}
                      activity={activity}
                      now={now}
                      busy={exercisePendingKey === activity.key}
                      startBlocked={runningGym && activity.status !== 'running'}
                      onAction={(target, action) =>
                        void actOnExercise(target, action)
                      }
                    />
                  ))}
                  {filtered.slice(0, visible).map((task) => {
                    const running = Boolean(task.timerStartedAt)
                    const tracked = trackedSeconds(task)
                    const busy = pendingKey === task.key
                    const startBlocked =
                      task.source === 'work' && runningWork && !running
                    const description =
                      task.source === 'education'
                        ? task.description
                        : task.notes
                    return (
                      <li
                        key={task.key}
                        className='rounded-lg border p-3 transition-colors hover:bg-muted/30'
                      >
                        <div className='flex flex-wrap items-center justify-between gap-3'>
                          <div className='flex min-w-0 flex-1 flex-col items-start gap-1.5'>
                            <button
                              type='button'
                              onClick={() =>
                                setExpanded((current) =>
                                  current === task.key ? null : task.key
                                )
                              }
                              aria-expanded={expanded === task.key}
                              className='flex w-full min-w-0 flex-col items-start gap-1.5 text-start'
                            >
                              <span className='flex flex-wrap items-center gap-1.5'>
                                <span className='font-medium'>
                                  {task.title}
                                </span>
                                {task.bucket === 'done' ? (
                                  <CheckCircle2 className='size-4 text-emerald-500' />
                                ) : null}
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
                                <Badge
                                  variant={
                                    task.bucket === 'done'
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                >
                                  {statusLabel(task)}
                                </Badge>
                                {running ? (
                                  <span className='inline-flex items-center gap-1 text-xs font-medium text-emerald-600'>
                                    <span className='size-2 animate-pulse rounded-full bg-emerald-500' />
                                    {t('dashboard.timerRunning')}
                                  </span>
                                ) : null}
                              </span>
                              <span className='text-xs text-muted-foreground'>
                                {formatJalaliDateKey(task.dateKey)} ·{' '}
                                {task.time} · {task.estimatedMinutes}{' '}
                                {t('dashboard.minutes')}
                                {task.track
                                  ? ` · ${t(`learning.tracks.${task.track}`)}`
                                  : null}
                                {task.source === 'work' &&
                                task.isCompanyWork === false
                                  ? ` · ${t('tasks.freelance')}`
                                  : null}
                              </span>
                            </button>
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge
                              variant='secondary'
                              className='font-mono tabular-nums'
                            >
                              <Timer className='me-1 size-3.5' />
                              {t('dashboard.actualTime')}:{' '}
                              {formatDuration(tracked)}
                            </Badge>
                            {task.bucket !== 'done' ? (
                              <>
                                {running ? (
                                  <Button
                                    size='icon'
                                    variant='outline'
                                    aria-label={t('dashboard.pause')}
                                    title={t('dashboard.pause')}
                                    disabled={busy}
                                    onClick={() => void act(task, 'pause')}
                                  >
                                    <Pause className='size-4' />
                                  </Button>
                                ) : (
                                  <Button
                                    size='icon'
                                    variant='outline'
                                    aria-label={t('dashboard.start')}
                                    title={t('dashboard.start')}
                                    disabled={busy || startBlocked}
                                    onClick={() => void act(task, 'start')}
                                  >
                                    <Play className='size-4' />
                                  </Button>
                                )}
                                <Button
                                  size='icon'
                                  aria-label={t('dashboard.complete')}
                                  title={t('dashboard.complete')}
                                  disabled={busy}
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
                              title={t('dashboard.tasksDetails')}
                              onClick={() =>
                                setExpanded((current) =>
                                  current === task.key ? null : task.key
                                )
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
                        {description?.trim() ? (
                          <Collapsible
                            open={descriptionOpen.has(task.key)}
                            onOpenChange={() => toggleDescription(task.key)}
                            className='mt-2 w-full max-w-full border-t pt-2'
                          >
                            <CollapsibleTrigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                className='h-6 gap-1 px-1.5 py-0 text-xs text-muted-foreground'
                                aria-label={t(
                                  'learning.tasks.descriptionToggle'
                                )}
                              >
                                <ChevronDown
                                  className={`size-3.5 shrink-0 transition-transform ${descriptionOpen.has(task.key) ? 'rotate-180' : ''}`}
                                />
                                {t('learning.tasks.descriptionToggle')}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className='pt-1 text-sm text-muted-foreground'>
                              <TaskDescription value={description} />
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
                        {expanded === task.key ? (
                          <div className='space-y-1.5 border-t pt-2 text-sm'>
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
                            <p>
                              {t('dashboard.tasksStudied')}:{' '}
                              <span className='font-mono tabular-nums'>
                                {formatDuration(tracked)}
                              </span>
                            </p>
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
                {filtered.length ? (
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
                        onClick={() =>
                          setVisible((current) => current + PAGE_SIZE)
                        }
                      >
                        {t('dashboard.tasksShowMore')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
