import { useMemo, useRef, useState, type FormEvent } from 'react'
import { TASK_PRIORITIES, type TaskPriority } from '@/types/timeline'
import {
  Check,
  ChevronDown,
  Clock3,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTimeValue } from '@/lib/time'
import type { LearningTrack } from '@/services/db'
import {
  deleteEducationReport,
  deleteEducationTask,
  educationElapsedSeconds,
  finishEducationTaskTimer,
  pauseEducationTaskTimer,
  saveEducationReport,
  saveEducationTask,
  startEducationTaskTimer,
  updateEducationReport,
  type EducationReport,
  type EducationTask,
  type EducationTaskStatus,
} from '@/services/education'
import type { EducationItem } from '@/services/learning'
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
import { Textarea } from '@/components/ui/textarea'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { TimePicker24 } from '@/components/time-picker-24'
import { TaskDescription } from '@/features/tasks/components/task-description'
import {
  displayTaskStatus,
  filterEducationTasks,
  formatStudyDuration,
  reportCountByTask,
  sortEducationTasks,
  type EducationTaskFilters,
  type EducationTaskSort,
  type EducationTaskStatusFilter,
} from './education-utils'
import {
  ProgressReportForm,
  ReportBody,
  reportDraftFrom,
  reportTimestamp,
  type ReportDraft,
} from './report-components'

const TRACKS: LearningTrack[] = ['masters', 'university', 'course']

interface TaskFormState {
  id?: string
  title: string
  track: LearningTrack
  courseId: string
  description: string
  priority: TaskPriority
  estimatedMinutes: string
  dateKey: string
  time: string
  status: EducationTaskStatus
}

const emptyTaskForm = (track: LearningTrack = 'masters'): TaskFormState => ({
  title: '',
  track,
  courseId: '',
  description: '',
  priority: 'medium',
  estimatedMinutes: '60',
  dateKey: toDateKey(new Date()),
  time: '09:00',
  status: 'pending',
})

function formFromTask(task: EducationTask): TaskFormState {
  return {
    id: task.id,
    title: task.title,
    track: task.track,
    courseId: task.courseId ?? '',
    description: task.description ?? '',
    priority: task.priority,
    estimatedMinutes: String(task.estimatedMinutes),
    dateKey: task.dateKey,
    time: task.time,
    status: task.status,
  }
}

function priorityVariant(priority: TaskPriority) {
  if (priority === 'urgent') return 'destructive' as const
  if (priority === 'high') return 'default' as const
  return 'outline' as const
}

interface TaskReportsProps {
  task: EducationTask
  reports: EducationReport[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

/** Collapsible, append-only progress-report history of one task. */
function TaskReports({ task, reports, onChanged, onError }: TaskReportsProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const language = i18n.resolvedLanguage ?? i18n.language

  const history = reports
    .filter((report) => report.taskId === task.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const editing = history.find((report) => report.id === editingId)

  const submit = async (draft: ReportDraft) => {
    onError('')
    try {
      if (editingId) {
        await updateEducationReport(editingId, draft)
      } else {
        await saveEducationReport({ taskId: task.id, ...draft })
      }
      setAdding(false)
      setEditingId(undefined)
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  const remove = async (report: EducationReport) => {
    if (!window.confirm(t('learning.reports.confirmDelete'))) return
    onError('')
    try {
      await deleteEducationReport(report.id)
      if (editingId === report.id) setEditingId(undefined)
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type='button' variant='ghost' size='sm' className='gap-2'>
          <MessageSquare className='size-4' />
          {t('learning.tasks.progressReports')}
          <Badge variant='secondary'>{history.length}</Badge>
          <ChevronDown
            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-3 space-y-3 border-t pt-3'>
        {adding || editing ? (
          <div className='rounded-lg bg-muted/30 p-3'>
            <p className='mb-2 text-sm font-medium'>
              {t(
                editing
                  ? 'learning.reportForm.editTitle'
                  : 'learning.reportForm.addTitle'
              )}
            </p>
            <ProgressReportForm
              key={editingId ?? 'new'}
              initial={editing ? reportDraftFrom(editing) : undefined}
              submitLabel={t(
                editing
                  ? 'learning.reportForm.update'
                  : 'learning.reportForm.save'
              )}
              onSubmit={submit}
              onCancel={() => {
                setAdding(false)
                setEditingId(undefined)
              }}
            />
          </div>
        ) : (
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => {
              setAdding(true)
              setEditingId(undefined)
            }}
          >
            <Plus className='me-2 size-4' />
            {t('learning.reportForm.addTitle')}
          </Button>
        )}

        {history.length ? (
          <div className='space-y-2'>
            {history.map((report) => (
              <div key={report.id} className='rounded-lg border p-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                    <Clock3 className='size-3.5' />
                    <span>{reportTimestamp(report, language)}</span>
                    <Badge variant='outline' className='font-mono tabular-nums'>
                      {formatStudyDuration(report.durationSeconds)}
                    </Badge>
                    <Badge variant='secondary'>
                      {t(`learning.taskStatuses.${report.taskStatus}`)}
                    </Badge>
                  </div>
                  <div className='flex gap-1'>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      aria-label={t('learning.reports.edit')}
                      onClick={() => {
                        setEditingId(report.id)
                        setAdding(false)
                      }}
                    >
                      <Pencil className='size-4' />
                    </Button>
                    <Button
                      type='button'
                      size='icon'
                      variant='ghost'
                      aria-label={t('learning.reports.delete')}
                      onClick={() => void remove(report)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </div>
                <div className='mt-2'>
                  <ReportBody report={report} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('learning.reportForm.noReports')}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

interface TaskCardProps {
  task: EducationTask
  reports: EducationReport[]
  items: EducationItem[]
  now: number
  onChanged: () => Promise<void>
  onError: (message: string) => void
  onEdit: (task: EducationTask) => void
}

export function TaskCard({
  task,
  reports,
  items,
  now,
  onChanged,
  onError,
  onEdit,
}: TaskCardProps) {
  const { t, i18n } = useTranslation()
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const language = i18n.resolvedLanguage ?? i18n.language
  const running = Boolean(task.timerStartedAt)
  const status = displayTaskStatus(task)
  const elapsed = educationElapsedSeconds(task, now)
  const course = task.courseId
    ? items.find((item) => item.id === task.courseId)
    : undefined
  const reportCount = reportCountByTask(reports)[task.id] ?? 0

  const act = async (action: 'start' | 'pause' | 'finish') => {
    onError('')
    try {
      if (action === 'start') await startEducationTaskTimer(task.id)
      if (action === 'pause') await pauseEducationTaskTimer(task.id)
      if (action === 'finish') await finishEducationTaskTimer(task.id)
      await onChanged()
    } catch {
      onError(t('learning.errors.timer'))
    }
  }

  const remove = async () => {
    onError('')
    if (reportCount) {
      if (
        !window.confirm(
          t('learning.tasks.confirmDeleteWithReports', { count: reportCount })
        )
      ) {
        return
      }
    } else if (!window.confirm(t('learning.tasks.confirmDelete'))) {
      return
    }
    try {
      await deleteEducationTask(task.id)
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  return (
    <div
      className={`rounded-lg border p-3 ${running ? 'border-primary bg-primary/5' : ''}`}
    >
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='font-medium'>{task.title}</p>
            <Badge variant={priorityVariant(task.priority)}>
              {t(`learning.priorities.${task.priority}`)}
            </Badge>
            <Badge
              variant={
                running
                  ? 'default'
                  : status === 'completed'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {running
                ? t('learning.tasks.running')
                : t(`learning.taskStatuses.${status}`)}
            </Badge>
            <Badge variant='outline'>
              {t(`learning.tracks.${task.track}`)}
            </Badge>
            <Badge variant='secondary'>
              {course?.title ?? t('learning.tasks.noCourse')}
            </Badge>
          </div>
          <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <span className='inline-flex items-center gap-1'>
              <Clock3 className='size-3.5' />
              {formatJalaliDateKey(task.dateKey)}
            </span>
            <span className='font-mono tabular-nums'>
              {formatClockTimeValue(task.time, language)}
            </span>
            <span>
              {t('learning.tasks.estimated')}: {task.estimatedMinutes}{' '}
              {t('learning.tasks.minutes')}
            </span>
            <span className='inline-flex items-center gap-1 font-mono tabular-nums'>
              <Timer className='size-3.5' />
              {t('learning.tasks.actual')}: {formatStudyDuration(elapsed)}
            </span>
          </div>
          {task.description?.trim() ? (
            <Collapsible
              open={descriptionOpen}
              onOpenChange={setDescriptionOpen}
              className='mt-1'
            >
              <CollapsibleTrigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-6 gap-1 px-1.5 py-0 text-xs text-muted-foreground'
                  aria-label={t('learning.tasks.descriptionToggle')}
                >
                  <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform ${descriptionOpen ? 'rotate-180' : ''}`}
                  />
                  {t('learning.tasks.descriptionToggle')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className='pt-1 text-sm text-muted-foreground'>
                <TaskDescription value={task.description} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {status !== 'completed' ? (
          <>
            {running ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => void act('pause')}
              >
                <Pause className='me-2 size-4' />
                {t('learning.tasks.pause')}
              </Button>
            ) : (
              <Button size='sm' onClick={() => void act('start')}>
                <Play className='me-2 size-4' />
                {status === 'paused'
                  ? t('learning.tasks.resume')
                  : t('learning.tasks.start')}
              </Button>
            )}
            <Button
              size='sm'
              variant='secondary'
              disabled={!running && elapsed === 0}
              onClick={() => void act('finish')}
            >
              <Check className='me-2 size-4' />
              {t('learning.tasks.finish')}
            </Button>
          </>
        ) : null}
        <Button size='sm' variant='outline' onClick={() => onEdit(task)}>
          <Pencil className='me-2 size-4' />
          {t('learning.tasks.edit')}
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='text-destructive hover:text-destructive'
          onClick={() => void remove()}
        >
          <Trash2 className='me-2 size-4' />
          {t('learning.tasks.delete')}
        </Button>
      </div>

      <div className='mt-2'>
        <TaskReports
          task={task}
          reports={reports}
          onChanged={onChanged}
          onError={onError}
        />
      </div>
    </div>
  )
}

interface TaskPanelProps {
  items: EducationItem[]
  tasks: EducationTask[]
  reports: EducationReport[]
  now: number
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

/**
 * Shared task workspace for the three education paths.
 *
 * The form, the sortable/filterable table and every course link are shared;
 * the path filter keeps the three paths distinguishable.
 */
export function TaskPanel({
  items,
  tasks,
  reports,
  now,
  onChanged,
  onError,
}: TaskPanelProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm)
  const [sort, setSort] = useState<EducationTaskSort>('priority')
  const [filters, setFilters] = useState<EducationTaskFilters>({
    track: 'all',
    courseId: 'all',
    status: 'open',
    query: '',
  })
  const formRef = useRef<HTMLFormElement>(null)

  const formCourses = items.filter((item) => item.track === form.track)
  const filterCourses =
    filters.track === 'all'
      ? items
      : items.filter((item) => item.track === filters.track)

  const filtered = useMemo(
    () => filterEducationTasks(tasks, filters),
    [tasks, filters]
  )
  const openTasks = useMemo(
    () =>
      sortEducationTasks(
        filtered.filter((task) => displayTaskStatus(task) !== 'completed'),
        sort
      ),
    [filtered, sort]
  )
  const completedTasks = useMemo(
    () =>
      filtered
        .filter((task) => displayTaskStatus(task) === 'completed')
        .sort((a, b) =>
          (b.completedAt ?? b.updatedAt).localeCompare(
            a.completedAt ?? a.updatedAt
          )
        ),
    [filtered]
  )
  const hasAnyTask = tasks.length > 0

  const set = (patch: Partial<TaskFormState>) => setForm({ ...form, ...patch })

  const save = async (event: FormEvent) => {
    event.preventDefault()
    onError('')
    const estimatedMinutes = Number(form.estimatedMinutes)
    if (
      !form.title.trim() ||
      !Number.isInteger(estimatedMinutes) ||
      estimatedMinutes < 1
    ) {
      onError(t('learning.taskForm.invalid'))
      return
    }
    try {
      await saveEducationTask({
        ...(form.id ? { id: form.id } : {}),
        track: form.track,
        ...(form.courseId ? { courseId: form.courseId } : {}),
        title: form.title,
        description: form.description,
        priority: form.priority,
        estimatedMinutes,
        dateKey: form.dateKey,
        time: form.time,
        status: form.status,
      })
      setForm(emptyTaskForm(form.track))
      await onChanged()
    } catch {
      onError(t('learning.errors.save'))
    }
  }

  const edit = (task: EducationTask) => {
    setForm(formFromTask(task))
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const changePath = (track: 'all' | LearningTrack) => {
    setFilters({ ...filters, track, courseId: 'all' })
  }

  const changeFormTrack = (track: LearningTrack) => {
    // A linked course only stays selected when it belongs to the new path.
    const stillValid = items.some(
      (item) => item.id === form.courseId && item.track === track
    )
    setForm({
      ...form,
      track,
      courseId: stillValid ? form.courseId : '',
    })
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Plus className='size-5' />
            {t(
              form.id
                ? 'learning.taskForm.titleEdit'
                : 'learning.taskForm.titleAdd'
            )}
          </CardTitle>
          <CardDescription>{t('learning.taskForm.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            ref={formRef}
            className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'
            onSubmit={(event) => void save(event)}
          >
            <Input
              required
              className='md:col-span-2'
              value={form.title}
              onChange={(event) => set({ title: event.target.value })}
              aria-label={t('learning.taskForm.name')}
              placeholder={t('learning.taskForm.namePlaceholder')}
            />
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.taskForm.path')}
              value={form.track}
              onChange={(event) =>
                changeFormTrack(event.target.value as LearningTrack)
              }
            >
              {TRACKS.map((track) => (
                <option key={track} value={track}>
                  {t(`learning.tracks.${track}`)}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.taskForm.course')}
              value={form.courseId}
              onChange={(event) => set({ courseId: event.target.value })}
            >
              <option value=''>{t('learning.taskForm.noCourse')}</option>
              {formCourses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.taskForm.priority')}
              value={form.priority}
              onChange={(event) =>
                set({ priority: event.target.value as TaskPriority })
              }
            >
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`learning.priorities.${priority}`)}
                </option>
              ))}
            </select>
            <Input
              type='number'
              required
              min='1'
              max='10080'
              value={form.estimatedMinutes}
              onChange={(event) =>
                set({ estimatedMinutes: event.target.value })
              }
              aria-label={t('learning.taskForm.estimatedMinutes')}
              placeholder={t('learning.taskForm.estimatedMinutes')}
            />
            <JalaliDatePicker
              value={form.dateKey}
              onChange={(dateKey) => set({ dateKey })}
              ariaLabel={t('learning.taskForm.date')}
            />
            <TimePicker24
              value={form.time}
              onChange={(time) => set({ time })}
              ariaLabel={t('learning.taskForm.time')}
            />
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.taskForm.status')}
              value={form.status}
              onChange={(event) =>
                set({ status: event.target.value as EducationTaskStatus })
              }
            >
              {(['pending', 'in_progress', 'paused', 'completed'] as const).map(
                (status) => (
                  <option key={status} value={status}>
                    {t(`learning.taskStatuses.${status}`)}
                  </option>
                )
              )}
            </select>
            <Textarea
              className='md:col-span-2 xl:col-span-3'
              rows={2}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
              aria-label={t('learning.taskForm.description')}
              placeholder={t('learning.taskForm.descriptionPlaceholder')}
            />
            <div className='flex flex-wrap items-end gap-2'>
              <Button type='submit'>
                <Plus className='me-2 size-4' />
                {t(
                  form.id ? 'learning.taskForm.update' : 'learning.taskForm.add'
                )}
              </Button>
              {form.id ? (
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setForm(emptyTaskForm(form.track))}
                >
                  <X className='me-2 size-4' />
                  {t('learning.taskForm.cancel')}
                </Button>
              ) : null}
            </div>
          </form>
          {formCourses.length === 0 ? (
            <p className='mt-3 text-xs text-muted-foreground'>
              {t('learning.taskForm.noCoursesHint')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('learning.tasks.title')}</CardTitle>
          <CardDescription>{t('learning.tasks.hint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5'>
            <div className='relative sm:col-span-2 xl:col-span-2'>
              <Search className='pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground' />
              <Input
                className='ps-8'
                value={filters.query}
                onChange={(event) =>
                  setFilters({ ...filters, query: event.target.value })
                }
                aria-label={t('learning.tasks.search')}
                placeholder={t('learning.tasks.searchPlaceholder')}
              />
            </div>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.tasks.pathFilter')}
              value={filters.track}
              onChange={(event) =>
                changePath(event.target.value as 'all' | LearningTrack)
              }
            >
              <option value='all'>{t('learning.tasks.allPaths')}</option>
              {TRACKS.map((track) => (
                <option key={track} value={track}>
                  {t(`learning.tracks.${track}`)}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.tasks.courseFilter')}
              value={filters.courseId}
              onChange={(event) =>
                setFilters({ ...filters, courseId: event.target.value })
              }
            >
              <option value='all'>{t('learning.tasks.allCourses')}</option>
              {filterCourses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.tasks.statusFilter')}
              value={filters.status}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  status: event.target.value as EducationTaskStatusFilter,
                })
              }
            >
              <option value='open'>{t('learning.tasks.openOnly')}</option>
              <option value='all'>{t('learning.tasks.allStatuses')}</option>
              {(['pending', 'in_progress', 'paused', 'completed'] as const).map(
                (status) => (
                  <option key={status} value={status}>
                    {t(`learning.taskStatuses.${status}`)}
                  </option>
                )
              )}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              aria-label={t('learning.tasks.sort')}
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as EducationTaskSort)
              }
            >
              <option value='priority'>
                {t('learning.tasks.sortPriority')}
              </option>
              <option value='date'>{t('learning.tasks.sortDate')}</option>
              <option value='time'>{t('learning.tasks.sortTime')}</option>
            </select>
          </div>

          {openTasks.length ? (
            <div className='space-y-3'>
              {openTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  reports={reports}
                  items={items}
                  now={now}
                  onChanged={onChanged}
                  onError={onError}
                  onEdit={edit}
                />
              ))}
            </div>
          ) : filters.status === 'completed' ? null : (
            <div className='rounded-lg border border-dashed p-6 text-center'>
              <p className='text-sm font-medium'>
                {hasAnyTask
                  ? t('learning.tasks.empty')
                  : t('learning.tasks.emptyAll')}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {hasAnyTask
                  ? t('learning.tasks.emptyHint')
                  : t('learning.tasks.emptyAllHint')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {completedTasks.length ? (
        <Collapsible
          key={filters.status}
          defaultOpen={filters.status === 'completed'}
        >
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className='cursor-pointer'>
                <CardTitle className='flex items-center justify-between gap-2'>
                  <span className='flex items-center gap-2'>
                    <Check className='size-5' />
                    {t('learning.tasks.completedTitle')}
                  </span>
                  <span className='flex items-center gap-2'>
                    <Badge variant='secondary'>{completedTasks.length}</Badge>
                    <ChevronDown className='size-4' />
                  </span>
                </CardTitle>
                <CardDescription>
                  {t('learning.tasks.completedHint')}
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className='space-y-3'>
                {completedTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    reports={reports}
                    items={items}
                    now={now}
                    onChanged={onChanged}
                    onError={onError}
                    onEdit={edit}
                  />
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}
    </div>
  )
}
