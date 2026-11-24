import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  TASK_PRIORITIES,
  type TaskPriority,
  type TimelineBlockRecord,
} from '@/types/timeline'
import {
  Bell,
  BellRing,
  CalendarPlus,
  Check,
  ChevronDown,
  ClipboardCopy,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import {
  clockDateFromParts,
  clockTimeFromDate,
  formatClockTime,
} from '@/lib/time'
import {
  cancelTaskAlarm,
  getAlarms,
  saveAlarm,
  ALARMS_CHANGED_EVENT,
  notifyAlarmsChanged,
  type AlarmRecord,
} from '@/services/alarms'
import {
  autoRolloverStaleWorkTasks,
  completeWorkTask,
  deleteWorkTask,
  getAllWorkTasks,
  getLegacyTasks,
  getTimelineBlocksByRange,
  getWorkSessionsByRange,
  getWorkTasksByDate,
  pauseWorkTaskTimer,
  rolloverWorkTask,
  runStartupRollover,
  saveWorkTask,
  startWorkTaskTimer,
  stopWorkTaskTimer,
  updateWorkTask,
  type LegacyLifeTask,
} from '@/services/db'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { HeaderActions } from '@/components/header-actions'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TimePicker24 } from '@/components/time-picker-24'
import { TaskDescription } from './components/task-description'
import {
  formatDuration,
  summarizeTaskReport,
  taskElapsedSeconds,
} from './work-task-utils'

function shiftDateKey(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  return toDateKey(date)
}

const TASK_STATUSES = [
  'planned',
  'in_progress',
  'paused',
  'rolled_over',
  'completed',
  'skipped',
] as const
type TaskStatus = (typeof TASK_STATUSES)[number]

export function WorkTasksPanel({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation()
  const [date, setDate] = useState(toDateKey(new Date()))
  const [tasks, setTasks] = useState<TimelineBlockRecord[]>([])
  const [yesterday, setYesterday] = useState<TimelineBlockRecord[]>([])
  const [legacyTasks, setLegacyTasks] = useState<LegacyLifeTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState('60')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [notes, setNotes] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [error, setError] = useState('')
  const [movedCount, setMovedCount] = useState(0)
  const [movedAway, setMovedAway] = useState<TimelineBlockRecord[]>([])
  const [reportFrom, setReportFrom] = useState(toDateKey(new Date()))
  const [reportTo, setReportTo] = useState(toDateKey(new Date()))
  const [copied, setCopied] = useState(false)
  const [alarms, setAlarms] = useState<AlarmRecord[]>([])
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderDate, setReminderDate] = useState(toDateKey(new Date()))
  const [reminderTime, setReminderTime] = useState('09:00')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [descriptionOpen, setDescriptionOpen] = useState<Set<string>>(
    () => new Set()
  )
  const rolloverChecked = useRef(false)

  const load = async () => {
    const [current, previous, all, legacy, projectList, alarmList] =
      await Promise.all([
        getWorkTasksByDate(date),
        getWorkTasksByDate(shiftDateKey(date, -1)),
        getAllWorkTasks(),
        getLegacyTasks(),
        getProjects(),
        getAlarms(),
      ])
    const running = all.find(
      (task) => task.timerStartedAt && task.status === 'in_progress'
    )
    const union = [...current]
    if (running && !union.some((task) => task.id === running.id))
      union.unshift(running)
    setTasks(union)
    setYesterday(
      previous.filter(
        (task) => task.status !== 'completed' && task.status !== 'skipped'
      )
    )
    setLegacyTasks(legacy)
    setProjects(projectList)
    setAlarms(alarmList)
    setMovedAway(
      all.filter(
        (task) =>
          task.status === 'rolled_over' &&
          task.rolledOverFrom === date &&
          task.dateKey !== date
      )
    )
  }

  useEffect(() => {
    void runStartupRollover()
      .catch(() => [])
      .then(() => load())
      .catch(() => setError(t('tasks.loadError')))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on selected date only
  }, [date])

  useEffect(() => {
    if (rolloverChecked.current) return
    rolloverChecked.current = true
    void runStartupRollover()
      .catch(() => [])
      .then(() => autoRolloverStaleWorkTasks())
      .then(async (moved) => {
        if (moved.length) {
          setMovedCount(moved.length)
          await load()
        }
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startup only
  }, [])

  const activeTask = useMemo(
    () =>
      tasks.find(
        (task) => task.timerStartedAt && task.status === 'in_progress'
      ),
    [tasks]
  )

  useEffect(() => {
    const reload = () => {
      void getAlarms()
        .then(setAlarms)
        .catch(() => undefined)
    }
    window.addEventListener(ALARMS_CHANGED_EVENT, reload)
    return () => window.removeEventListener(ALARMS_CHANGED_EVENT, reload)
  }, [])

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (!needle) return true
      return (
        task.title.toLowerCase().includes(needle) ||
        (task.notes ?? '').toLowerCase().includes(needle)
      )
    })
  }, [tasks, search, statusFilter])

  const toggleDescription = (id: string) => {
    setDescriptionOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const resetForm = () => {
    setEditingId(undefined)
    setTitle('')
    setNotes('')
    setPriority('medium')
    setDuration('60')
    setProjectId('')
    setReminderEnabled(false)
    setReminderDate(date)
    setReminderTime(time)
  }

  const addTask = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const startTime = clockDateFromParts(date, time)
    if (!startTime) {
      setError(t('tasks.invalidError'))
      return
    }
    try {
      const payload = {
        title,
        startTime,
        durationMinutes: Number(duration),
        // The form no longer asks for company/freelance; tracked tasks stay work.
        isCompanyWork: true,
        priority,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(projectId ? { projectId } : {}),
      }
      const saved = editingId
        ? await updateWorkTask(editingId, payload)
        : await saveWorkTask(payload)
      const reminderAt = reminderEnabled
        ? clockDateFromParts(reminderDate, reminderTime)
        : null
      if (reminderAt) {
        await saveAlarm({
          id: `task-${saved.id}`,
          title: saved.title,
          at: reminderAt,
          taskId: saved.id,
          source: 'task',
        })
      } else {
        await cancelTaskAlarm(saved.id)
      }
      notifyAlarmsChanged()
      resetForm()
      await load()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(
        message.includes('lunch')
          ? t('tasks.lunchError')
          : message.includes('overlaps')
            ? t('tasks.overlapError')
            : message.includes('cannot be edited')
              ? t('tasks.editCompletedError')
              : t('tasks.invalidError')
      )
    }
  }

  const act = async (
    task: TimelineBlockRecord,
    action: 'start' | 'pause' | 'stop' | 'complete'
  ) => {
    setError('')
    try {
      if (action === 'start') await startWorkTaskTimer(task.id)
      if (action === 'pause') await pauseWorkTaskTimer(task.id)
      if (action === 'stop') await stopWorkTaskTimer(task.id)
      if (action === 'complete') await completeWorkTask(task.id)
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes('another work timer')
          ? t('tasks.singleTimerError')
          : t('tasks.timerError')
      )
    }
  }

  const moveForward = async (task: TimelineBlockRecord) => {
    setError('')
    try {
      await rolloverWorkTask(task.id, date)
      await load()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(
        message.includes('lunch')
          ? t('tasks.lunchError')
          : t('tasks.overlapError')
      )
    }
  }

  const editTask = (task: TimelineBlockRecord) => {
    setEditingId(task.id)
    setTitle(task.title)
    setDate(task.dateKey)
    setTime(clockTimeFromDate(new Date(task.startTime)))
    setDuration(String(task.durationMinutes))
    setPriority(task.priority ?? 'medium')
    setNotes(task.notes ?? '')
    setProjectId(task.projectId ?? '')
    const alarm = alarms.find((row) => row.taskId === task.id)
    const alarmDate = alarm ? new Date(alarm.at) : null
    setReminderEnabled(Boolean(alarmDate && alarm?.status === 'scheduled'))
    setReminderDate(alarmDate ? toDateKey(alarmDate) : task.dateKey)
    setReminderTime(
      alarmDate
        ? clockTimeFromDate(alarmDate)
        : clockTimeFromDate(new Date(task.startTime))
    )
  }

  const removeTask = async (task: TimelineBlockRecord) => {
    if (!window.confirm(t('tasks.confirmDelete'))) return
    setError('')
    try {
      await deleteWorkTask(task.id)
      await cancelTaskAlarm(task.id)
      notifyAlarmsChanged()
      if (editingId === task.id) resetForm()
      await load()
    } catch {
      setError(t('tasks.deleteError'))
    }
  }

  const makeReport = async () => {
    setCopied(false)
    try {
      const [blocks, savedSessions] = await Promise.all([
        getTimelineBlocksByRange(reportFrom, reportTo),
        getWorkSessionsByRange(reportFrom, reportTo),
      ])
      const workTasks = blocks.filter(
        (block) => block.category === 'work' || block.category === 'freelance'
      )
      const report = summarizeTaskReport(workTasks, 'all', now, savedSessions)
      const sessions = [
        ...report.tasks.map((task) => task.title),
        ...report.sessions.map(
          (session) => `${session.clientName} · ${session.taskType}`
        ),
      ]
      const text = t('tasks.reportLine', {
        from: formatJalaliDateKey(reportFrom),
        to: formatJalaliDateKey(reportTo),
        hours: (report.seconds / 3600).toFixed(2),
        items: sessions.length ? sessions.join('، ') : t('tasks.noReportTasks'),
      })
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError(t('tasks.copyError'))
    }
  }

  const statusLabel = (task: TimelineBlockRecord) =>
    task.status === 'in_progress' && !task.timerStartedAt
      ? t('tasks.status.paused')
      : t(`tasks.status.${task.status}`)

  const priorityVariant = (value: TaskPriority) =>
    value === 'urgent'
      ? 'destructive'
      : value === 'high'
        ? 'default'
        : 'outline'

  const scheduledAlarm = (task: TimelineBlockRecord) =>
    alarms.find(
      (alarm) => alarm.taskId === task.id && alarm.status === 'scheduled'
    )

  const row = (task: TimelineBlockRecord) => {
    const alarm = scheduledAlarm(task)
    return (
      <div
        key={task.id}
        className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'
      >
        <div className='min-w-48 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='font-medium'>{task.title}</p>
            <Badge variant={priorityVariant(task.priority ?? 'medium')}>
              {t(`tasks.priority.${task.priority ?? 'medium'}`)}
            </Badge>
            <Badge
              variant={task.status === 'completed' ? 'secondary' : 'outline'}
            >
              {statusLabel(task)}
            </Badge>
            {task.projectId ? (
              <Badge variant='secondary'>
                {projects.find((project) => project.id === task.projectId)
                  ?.title ?? t('tasks.project')}
              </Badge>
            ) : null}
            {alarm ? (
              <Badge variant='outline' className='font-mono tabular-nums'>
                <BellRing className='me-1 size-3.5' />
                {formatJalaliDateKey(toDateKey(new Date(alarm.at)))} ·{' '}
                {formatClockTime(new Date(alarm.at), i18n.language)}
              </Badge>
            ) : null}
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            {formatClockTime(new Date(task.startTime), i18n.language)} ·{' '}
            {task.durationMinutes} {t('tasks.minutes')}
            {task.rolledOverFrom
              ? ` · ${t('tasks.rolledFrom')} ${formatJalaliDateKey(task.rolledOverFrom)}`
              : ''}
          </p>
          {task.notes?.trim() ? (
            <Collapsible
              open={descriptionOpen.has(task.id)}
              onOpenChange={() => toggleDescription(task.id)}
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
                    className={`size-3.5 shrink-0 transition-transform ${descriptionOpen.has(task.id) ? 'rotate-180' : ''}`}
                  />
                  {t('learning.tasks.descriptionToggle')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className='pt-1 text-sm text-muted-foreground'>
                <TaskDescription value={task.notes} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='secondary' className='font-mono tabular-nums'>
            <Timer className='me-1 size-3.5' />
            {formatDuration(taskElapsedSeconds(task, now))}
          </Badge>
          {task.status !== 'completed' && task.status !== 'skipped' ? (
            <>
              {task.timerStartedAt ? (
                <Button
                  size='icon'
                  variant='outline'
                  aria-label={t('tasks.pause')}
                  onClick={() => void act(task, 'pause')}
                >
                  <Pause className='size-4' />
                </Button>
              ) : (
                <Button
                  size='icon'
                  variant='outline'
                  aria-label={t('tasks.resume')}
                  disabled={Boolean(activeTask)}
                  onClick={() => void act(task, 'start')}
                >
                  <Play className='size-4' />
                </Button>
              )}
              <Button
                size='icon'
                variant='outline'
                aria-label={t('tasks.stop')}
                onClick={() => void act(task, 'stop')}
                disabled={!task.timerStartedAt}
              >
                <Square className='size-4' />
              </Button>
              <Button
                size='icon'
                aria-label={t('tasks.complete')}
                onClick={() => void act(task, 'complete')}
              >
                <Check className='size-4' />
              </Button>
            </>
          ) : null}
          <Button
            size='icon'
            variant='ghost'
            aria-label={t('tasks.edit')}
            onClick={() => editTask(task)}
          >
            <Pencil className='size-4' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label={t('tasks.delete')}
            onClick={() => void removeTask(task)}
          >
            <Trash2 className='size-4' />
          </Button>
        </div>
      </div>
    )
  }

  const body = (
    <div className={embedded ? 'flex flex-col gap-5' : undefined}>
      {!embedded ? (
        <div>
          <h2 className='text-2xl font-bold'>{t('tasks.workTitle')}</h2>
          <p className='text-muted-foreground'>{t('tasks.workSubtitle')}</p>
        </div>
      ) : null}

      {activeTask ? (
        <Card className='border-primary'>
          <CardContent className='flex flex-wrap items-center justify-between gap-3 pt-6'>
            <p className='font-medium'>
              {t('tasks.activeTimer')}: {activeTask.title}
            </p>
            <Badge className='font-mono'>
              {formatDuration(taskElapsedSeconds(activeTask, now))}
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      {movedCount > 0 ? (
        <p
          role='status'
          className='rounded-md border border-primary/40 bg-primary/5 p-3 text-sm'
        >
          {t('tasks.autoMoved', { count: movedCount })}
        </p>
      ) : null}

      {movedAway.length > 0 ? (
        <div
          role='status'
          className='space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm'
        >
          <p>{t('tasks.movedAway', { count: movedAway.length })}</p>
          <ul className='space-y-1'>
            {movedAway.map((task) => (
              <li
                key={task.id}
                className='flex flex-wrap items-center justify-between gap-2'
              >
                <span>
                  {t('tasks.movedAwayItem', {
                    title: task.title,
                    date: formatJalaliDateKey(task.dateKey),
                    time: formatClockTime(
                      new Date(task.startTime),
                      i18n.language
                    ),
                  })}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setDate(task.dateKey)}
                >
                  {t('tasks.showMovedDay')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Plus className='size-5' />
            {t(editingId ? 'tasks.editWorkTask' : 'tasks.addWorkTask')}
          </CardTitle>
          <CardDescription>{t('tasks.lunchProtected')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'
            onSubmit={(event) => void addTask(event)}
          >
            <Input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('tasks.titlePlaceholder')}
            />
            <JalaliDatePicker
              value={date}
              onChange={setDate}
              ariaLabel={t('tasks.date')}
            />
            <TimePicker24
              value={time}
              onChange={setTime}
              ariaLabel={t('tasks.time')}
            />
            <Input
              type='number'
              min='1'
              max='720'
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              aria-label={t('tasks.durationMinutes')}
            />
            <select
              aria-label={t('tasks.priorityLabel')}
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
            >
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`tasks.priority.${value}`)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('tasks.project')}
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value=''>{t('tasks.noProject')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            <Textarea
              className='md:col-span-2 xl:col-span-2'
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('tasks.notesOptional')}
            />

            <div className='md:col-span-2 xl:col-span-4'>
              <Button
                type='button'
                variant={reminderEnabled ? 'secondary' : 'outline'}
                onClick={() => setReminderEnabled((current) => !current)}
              >
                <Bell className='me-2 size-4' />
                {t('alarms.reminder')}
              </Button>
              {reminderEnabled ? (
                <div className='mt-3 flex flex-wrap items-end gap-2'>
                  <label className='space-y-1 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('alarms.reminderDate')}
                    </span>
                    <JalaliDatePicker
                      value={reminderDate}
                      onChange={setReminderDate}
                      ariaLabel={t('alarms.reminderDate')}
                    />
                  </label>
                  <label className='space-y-1 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('alarms.reminderTime')}
                    </span>
                    <TimePicker24
                      value={reminderTime}
                      onChange={setReminderTime}
                      ariaLabel={t('alarms.reminderTime')}
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className='flex gap-2 md:col-span-2 xl:col-span-4'>
              <Button type='submit'>
                <CalendarPlus className='me-2 size-4' />
                {t(editingId ? 'tasks.updateTask' : 'tasks.createTask')}
              </Button>
              {editingId ? (
                <Button type='button' variant='outline' onClick={resetForm}>
                  <X className='me-2 size-4' />
                  {t('tasks.cancelEdit')}
                </Button>
              ) : null}
            </div>
          </form>
          {error ? (
            <p role='alert' className='mt-3 text-sm text-destructive'>
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('tasks.dayTasks')}</CardTitle>
          <CardDescription>{t('tasks.persistHint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative min-w-48 flex-1'>
              <Search className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                className='ps-9'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('dashboard.tasksSearch')}
                aria-label={t('dashboard.tasksSearch')}
              />
            </div>
            <select
              aria-label={t('dashboard.tasksStatusLabel')}
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | TaskStatus)
              }
            >
              <option value='all'>{t('dashboard.tasksStatusAll')}</option>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`tasks.status.${status}`)}
                </option>
              ))}
            </select>
          </div>
          {visibleTasks.length ? (
            visibleTasks.map(row)
          ) : (
            <p className='text-sm text-muted-foreground'>
              {tasks.length ? t('dashboard.tasksEmpty') : t('tasks.emptyDay')}
            </p>
          )}
        </CardContent>
      </Card>

      {legacyTasks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.legacyTitle')}</CardTitle>
            <CardDescription>{t('tasks.legacyHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {legacyTasks.map((task) => (
              <div
                key={task.id}
                className='flex items-center justify-between gap-3 rounded border p-3'
              >
                <span>{task.title}</span>
                <Badge variant='outline'>
                  {task.completedAt
                    ? t('tasks.status.completed')
                    : t('tasks.status.planned')}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {yesterday.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <RotateCcw className='size-5' />
              {t('tasks.carryOverTitle')}
            </CardTitle>
            <CardDescription>{t('tasks.carryOverHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {yesterday.map((task) => (
              <div
                key={task.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded border p-3'
              >
                <div>
                  <p className='font-medium'>{task.title}</p>
                  <p className='text-xs text-muted-foreground'>
                    {t(`tasks.status.${task.status}`)}
                  </p>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void moveForward(task)}
                >
                  <RotateCcw className='me-2 size-4' />
                  {t('tasks.rollToToday')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('tasks.reportTitle')}</CardTitle>
          <CardDescription>{t('tasks.reportHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-wrap items-center gap-2'>
            <JalaliDatePicker
              className='w-44'
              ariaLabel={t('tasks.reportFrom')}
              value={reportFrom}
              onChange={setReportFrom}
            />
            <JalaliDatePicker
              className='w-44'
              ariaLabel={t('tasks.reportTo')}
              value={reportTo}
              onChange={setReportTo}
            />
            <Button onClick={() => void makeReport()}>
              <ClipboardCopy className='me-2 size-4' />
              {t('tasks.copyReport')}
            </Button>
            {copied ? (
              <Badge variant='secondary'>{t('tasks.copied')}</Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )

  if (embedded) return body

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>{body}</Main>
    </>
  )
}

/** Backwards-compatible page wrapper (the `/tasks` route uses the panel directly). */
export function WorkTasksPage() {
  return <WorkTasksPanel />
}
