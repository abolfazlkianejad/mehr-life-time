/**
 * Gym module page: weekly plan management, real session logging and history.
 *
 * Plans (weekday → exercises) and performance sessions live in separate
 * IndexedDB stores, so editing or deleting the plan never loses logged
 * history. The three tabs load all gym data in one pass and refresh it after
 * every write. Dates use the Jalali picker and day keys stay Gregorian.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Dumbbell,
  History,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  GYM_WEEKDAY_I18N_KEYS,
  GYM_WEEKDAYS,
  weekdayOfDateKey,
  type GymWeekday,
} from '@/lib/gym-weekdays'
import {
  dateKeyOf,
  formatJalaliDateKey,
  formatTime24,
  toPersianDigits,
} from '@/lib/jalali'
import { cn } from '@/lib/utils'
import {
  completeGymSession,
  deleteGymExercise,
  deleteGymPlan,
  deleteGymSession,
  deleteGymSessionSet,
  getAllGymExercises,
  getAllGymSessionSets,
  getGymPlans,
  getGymSessions,
  moveGymExercise,
  saveGymExercise,
  saveGymPlan,
  saveGymSessionSet,
  startGymSession,
  updateGymExerciseName,
  updateGymSessionSet,
  type GymExercise,
  type GymPlan,
  type GymSession,
  type GymSessionSet,
} from '@/services/gym'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JalaliDatePicker } from '@/components/jalali-date-picker'

interface GymPageData {
  plans: GymPlan[]
  exercises: GymExercise[]
  sessions: GymSession[]
  sets: GymSessionSet[]
}

interface ExercisePerformance {
  dateKey: string
  topWeightKg: number
  topReps: number
  volumeKg: number
}

const MAX_REPS = 500
const MAX_WEIGHT_KG = 1000

function formatDecimal(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 10) / 10)
}

function sortSets(sets: GymSessionSet[]): GymSessionSet[] {
  return [...sets].sort(
    (a, b) =>
      a.setNumber - b.setNumber || a.createdAt.localeCompare(b.createdAt)
  )
}

/** Last logged performance of an exercise, excluding one session id. */
function exercisePerformance(
  data: GymPageData,
  exerciseId: string,
  excludeSessionId?: string
): ExercisePerformance | undefined {
  const bySession = new Map<string, GymSessionSet[]>()
  for (const set of data.sets) {
    if (set.exerciseId !== exerciseId) continue
    if (excludeSessionId && set.sessionId === excludeSessionId) continue
    const rows = bySession.get(set.sessionId)
    if (rows) rows.push(set)
    else bySession.set(set.sessionId, [set])
  }
  let best: { session: GymSession; sets: GymSessionSet[] } | undefined
  for (const session of data.sessions) {
    const rows = bySession.get(session.id)
    if (!rows || rows.length === 0) continue
    if (
      !best ||
      session.dateKey > best.session.dateKey ||
      (session.dateKey === best.session.dateKey &&
        session.createdAt > best.session.createdAt)
    ) {
      best = { session, sets: rows }
    }
  }
  if (!best) return undefined
  const top = best.sets.reduce((current, set) =>
    set.weightKg > current.weightKg ||
    (set.weightKg === current.weightKg && set.reps > current.reps)
      ? set
      : current
  )
  return {
    dateKey: best.session.dateKey,
    topWeightKg: top.weightKg,
    topReps: top.reps,
    volumeKg: best.sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
  }
}

function useNumberFormatter() {
  const { i18n } = useTranslation()
  const isPersian = (i18n.resolvedLanguage ?? i18n.language).startsWith('fa')
  return (value: number): string =>
    isPersian ? toPersianDigits(formatDecimal(value)) : formatDecimal(value)
}

/** Read-only list of a session's sets, grouped by exercise name snapshot. */
function SessionSetsList({ sets }: { sets: GymSessionSet[] }) {
  const { t } = useTranslation()
  const fmt = useNumberFormatter()
  const grouped = new Map<string, GymSessionSet[]>()
  for (const set of sets) {
    const rows = grouped.get(set.exerciseName)
    if (rows) rows.push(set)
    else grouped.set(set.exerciseName, [set])
  }
  if (sets.length === 0) {
    return <p className='text-sm text-muted-foreground'>{t('gym.noSets')}</p>
  }
  return (
    <div className='flex flex-col gap-3'>
      {[...grouped.entries()].map(([name, rows]) => (
        <div key={name} className='flex flex-col gap-1'>
          <p className='text-xs font-medium text-muted-foreground'>{name}</p>
          {rows.map((set) => (
            <p
              key={set.id}
              className='flex items-center justify-between gap-2 text-sm tabular-nums'
            >
              <span>
                {t('gym.set')} {fmt(set.setNumber)}
              </span>
              <span>
                {fmt(set.weightKg)} kg × {fmt(set.reps)} {t('gym.reps')}
              </span>
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

interface SessionCardProps {
  session: GymSession
  sets: GymSessionSet[]
  expanded: boolean
  onToggle: () => void
}

/** One session with a status badge and an expandable set list. */
function SessionCard({ session, sets, expanded, onToggle }: SessionCardProps) {
  const { t } = useTranslation()
  const fmt = useNumberFormatter()
  const dayLabel = t(`gym.days.${GYM_WEEKDAY_I18N_KEYS[session.weekday]}`)
  return (
    <div className='rounded-md border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{session.title}</p>
          <p className='text-xs text-muted-foreground'>
            {formatJalaliDateKey(session.dateKey)} · {dayLabel} ·{' '}
            {fmt(sets.length)} {t('gym.sets')}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Badge variant={session.status === 'done' ? 'default' : 'secondary'}>
            {session.status === 'done'
              ? t('gym.sessionDone')
              : t('gym.sessionDraft')}
          </Badge>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label={t('gym.expandSession')}
            onClick={onToggle}
          >
            {expanded ? (
              <ChevronUp className='size-4' />
            ) : (
              <ChevronDown className='size-4' />
            )}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className='mt-3 border-t pt-3'>
          <SessionSetsList sets={sets} />
        </div>
      )}
    </div>
  )
}

function parseSetInputs(
  repsText: string,
  weightText: string
): { reps: number; weightKg: number } | null {
  const reps = Number(repsText.trim())
  const weightKg = weightText.trim() === '' ? 0 : Number(weightText.trim())
  if (
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > MAX_REPS ||
    !Number.isFinite(weightKg) ||
    weightKg < 0 ||
    weightKg > MAX_WEIGHT_KG
  ) {
    return null
  }
  return { reps, weightKg }
}

export function GymPage() {
  const { t } = useTranslation()
  const fmt = useNumberFormatter()

  const [data, setData] = useState<GymPageData>({
    plans: [],
    exercises: [],
    sessions: [],
    sets: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState('plan')
  const [selectedWeekday, setSelectedWeekday] = useState<GymWeekday>(() =>
    weekdayOfDateKey(dateKeyOf(new Date()))
  )
  const [sessionDate, setSessionDate] = useState(() => dateKeyOf(new Date()))

  const [planTitleDraft, setPlanTitleDraft] = useState('')
  const [editingPlanTitle, setEditingPlanTitle] = useState(false)
  const [newExerciseName, setNewExerciseName] = useState('')
  const [editingExercise, setEditingExercise] = useState<{
    id: string
    name: string
  } | null>(null)
  const [setDrafts, setSetDrafts] = useState<
    Record<string, { reps: string; weightKg: string }>
  >({})
  const [editingSet, setEditingSet] = useState<{
    id: string
    reps: string
    weightKg: string
  } | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null
  )
  const [historyExerciseId, setHistoryExerciseId] = useState('')

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader updates state after an async read
    setLoading(true)
    setError('')
    void Promise.all([
      getGymPlans(),
      getAllGymExercises(),
      getGymSessions(),
      getAllGymSessionSets(),
    ])
      .then(([plans, exercises, sessions, sets]) => {
        if (!active) return
        setData({ plans, exercises, sessions, sets })
      })
      .catch(() => {
        if (active) setError(t('gym.loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  const refresh = useCallback(async () => {
    try {
      const [plans, exercises, sessions, sets] = await Promise.all([
        getGymPlans(),
        getAllGymExercises(),
        getGymSessions(),
        getAllGymSessionSets(),
      ])
      setData({ plans, exercises, sessions, sets })
      setError('')
    } catch {
      setError(t('gym.loadError'))
    }
  }, [t])

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setError('')
      try {
        await action()
        await refresh()
      } catch {
        setError(t('gym.saveError'))
      } finally {
        setBusy(false)
      }
    },
    [refresh, t]
  )

  const dayLabel = useCallback(
    (weekday: GymWeekday) => t(`gym.days.${GYM_WEEKDAY_I18N_KEYS[weekday]}`),
    [t]
  )

  const plansByWeekday = useMemo(() => {
    const map = new Map<GymWeekday, GymPlan>()
    for (const plan of data.plans) map.set(plan.weekday, plan)
    return map
  }, [data.plans])

  const selectedPlan = plansByWeekday.get(selectedWeekday)
  const selectedExercises = useMemo(
    () =>
      data.exercises.filter((exercise) => exercise.weekday === selectedWeekday),
    [data.exercises, selectedWeekday]
  )

  const sessionWeekday = weekdayOfDateKey(sessionDate)
  const sessionPlan = plansByWeekday.get(sessionWeekday)
  const sessionExercises = useMemo(
    () =>
      data.exercises.filter((exercise) => exercise.weekday === sessionWeekday),
    [data.exercises, sessionWeekday]
  )
  const daySessions = useMemo(
    () => data.sessions.filter((session) => session.dateKey === sessionDate),
    [data.sessions, sessionDate]
  )
  const draftSession = daySessions.find((session) => session.status === 'draft')
  const doneSessions = daySessions.filter(
    (session) => session.status === 'done'
  )

  const setsOfSession = useCallback(
    (sessionId: string) =>
      sortSets(data.sets.filter((set) => set.sessionId === sessionId)),
    [data.sets]
  )

  // Plan actions ------------------------------------------------------------

  const selectWeekday = (weekday: GymWeekday) => {
    setSelectedWeekday(weekday)
    setEditingPlanTitle(false)
    setPlanTitleDraft('')
    setEditingExercise(null)
    setNewExerciseName('')
  }

  const createPlan = (event: FormEvent) => {
    event.preventDefault()
    const title = planTitleDraft.trim()
    if (!title) {
      setError(t('gym.invalidTitle'))
      return
    }
    void run(async () => {
      await saveGymPlan(selectedWeekday, title)
      setPlanTitleDraft('')
    })
  }

  const updatePlanTitle = (event: FormEvent) => {
    event.preventDefault()
    const title = planTitleDraft.trim()
    if (!title) {
      setError(t('gym.invalidTitle'))
      return
    }
    void run(async () => {
      await saveGymPlan(selectedWeekday, title)
      setEditingPlanTitle(false)
    })
  }

  const removePlan = () => {
    void run(async () => {
      await deleteGymPlan(selectedWeekday)
      setEditingPlanTitle(false)
      setPlanTitleDraft('')
    })
  }

  const addExercise = (event: FormEvent) => {
    event.preventDefault()
    const name = newExerciseName.trim()
    if (!name) {
      setError(t('gym.invalidExercise'))
      return
    }
    void run(async () => {
      await saveGymExercise({ weekday: selectedWeekday, name })
      setNewExerciseName('')
    })
  }

  const renameExercise = (event: FormEvent) => {
    event.preventDefault()
    if (!editingExercise) return
    const name = editingExercise.name.trim()
    if (!name) {
      setError(t('gym.invalidExercise'))
      return
    }
    void run(async () => {
      await updateGymExerciseName(editingExercise.id, name)
      setEditingExercise(null)
    })
  }

  const removeExercise = (id: string) => {
    void run(() => deleteGymExercise(id))
  }

  const moveExercise = (id: string, direction: 'up' | 'down') => {
    void run(() => moveGymExercise(id, direction))
  }

  // Session actions ---------------------------------------------------------

  const beginSession = () => {
    if (!sessionPlan) return
    void run(() => startGymSession(sessionDate, sessionPlan.title))
  }

  const addSet = (exercise: GymExercise, session: GymSession) => {
    const draft = setDrafts[exercise.id]
    const parsed = parseSetInputs(draft?.reps ?? '', draft?.weightKg ?? '')
    if (!parsed) {
      setError(t('gym.invalidSet'))
      return
    }
    const existing = setsOfSession(session.id).filter(
      (set) => set.exerciseId === exercise.id
    )
    const nextNumber =
      existing.reduce((max, set) => Math.max(max, set.setNumber), 0) + 1
    void run(async () => {
      await saveGymSessionSet({
        sessionId: session.id,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        setNumber: nextNumber,
        reps: parsed.reps,
        weightKg: parsed.weightKg,
      })
      setSetDrafts((current) => ({
        ...current,
        [exercise.id]: { reps: '', weightKg: '' },
      }))
    })
  }

  const saveEditedSet = (set: GymSessionSet) => {
    if (!editingSet) return
    const parsed = parseSetInputs(editingSet.reps, editingSet.weightKg)
    if (!parsed) {
      setError(t('gym.invalidSet'))
      return
    }
    void run(async () => {
      await updateGymSessionSet(set.id, parsed)
      setEditingSet(null)
    })
  }

  const removeSet = (id: string) => {
    void run(() => deleteGymSessionSet(id))
  }

  const finishSession = (id: string) => {
    void run(() => completeGymSession(id))
  }

  const removeSession = (id: string) => {
    void run(() => deleteGymSession(id))
  }

  // History -----------------------------------------------------------------

  const historyExercises = useMemo(() => {
    const list: { id: string; name: string }[] = []
    const seen = new Set<string>()
    for (const exercise of data.exercises) {
      if (seen.has(exercise.id)) continue
      seen.add(exercise.id)
      list.push({ id: exercise.id, name: exercise.name })
    }
    for (const set of data.sets) {
      if (seen.has(set.exerciseId)) continue
      seen.add(set.exerciseId)
      list.push({ id: set.exerciseId, name: set.exerciseName })
    }
    return list
  }, [data])

  const historyEntries = useMemo(() => {
    if (!historyExerciseId) return []
    const bySession = new Map<string, GymSessionSet[]>()
    for (const set of data.sets) {
      if (set.exerciseId !== historyExerciseId) continue
      const rows = bySession.get(set.sessionId)
      if (rows) rows.push(set)
      else bySession.set(set.sessionId, [set])
    }
    const entries: {
      session: GymSession
      sets: GymSessionSet[]
      topWeightKg: number
      topReps: number
      volumeKg: number
    }[] = []
    for (const session of data.sessions) {
      const rows = bySession.get(session.id)
      if (!rows || rows.length === 0) continue
      const sorted = sortSets(rows)
      const top = sorted.reduce((current, set) =>
        set.weightKg > current.weightKg ||
        (set.weightKg === current.weightKg && set.reps > current.reps)
          ? set
          : current
      )
      entries.push({
        session,
        sets: sorted,
        topWeightKg: top.weightKg,
        topReps: top.reps,
        volumeKg: sorted.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
      })
    }
    return entries
  }, [data, historyExerciseId])

  if (loading) {
    return (
      <p role='status' className='text-sm text-muted-foreground'>
        {t('gym.hint')}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      <p className='text-muted-foreground'>{t('gym.hint')}</p>
      {error && (
        <p
          role='alert'
          className='rounded-md bg-destructive/10 p-3 text-sm text-destructive'
        >
          {error}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
        <TabsList className='w-full'>
          <TabsTrigger value='plan'>
            <ClipboardList />
            {t('gym.planTab')}
          </TabsTrigger>
          <TabsTrigger value='session'>
            <Dumbbell />
            {t('gym.sessionTab')}
          </TabsTrigger>
          <TabsTrigger value='history'>
            <History />
            {t('gym.historyTab')}
          </TabsTrigger>
        </TabsList>

        {/* Weekly plan -------------------------------------------------- */}
        <TabsContent value='plan' className='flex flex-col gap-4'>
          <div className='flex flex-wrap gap-2'>
            {GYM_WEEKDAYS.map((weekday) => {
              const hasPlan = plansByWeekday.has(weekday)
              const isSelected = weekday === selectedWeekday
              return (
                <Button
                  key={weekday}
                  type='button'
                  variant={isSelected ? 'default' : 'outline'}
                  size='sm'
                  aria-pressed={isSelected}
                  onClick={() => selectWeekday(weekday)}
                  className={cn(
                    'gap-2',
                    !isSelected && hasPlan && 'border-primary/40'
                  )}
                >
                  {dayLabel(weekday)}
                  {hasPlan && (
                    <span
                      aria-hidden='true'
                      className={cn(
                        'size-1.5 rounded-full',
                        isSelected ? 'bg-primary-foreground' : 'bg-primary'
                      )}
                    />
                  )}
                </Button>
              )
            })}
          </div>
          <p className='text-sm text-muted-foreground'>{t('gym.daysHint')}</p>

          <Card>
            <CardHeader>
              <CardTitle>{dayLabel(selectedWeekday)}</CardTitle>
              <CardDescription>{t('gym.planTitle')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {selectedPlan ? (
                editingPlanTitle ? (
                  <form
                    onSubmit={updatePlanTitle}
                    className='flex flex-wrap items-center gap-2'
                  >
                    <Input
                      value={planTitleDraft}
                      onChange={(event) =>
                        setPlanTitleDraft(event.target.value)
                      }
                      placeholder={t('gym.planTitlePlaceholder')}
                      aria-label={t('gym.planTitle')}
                      className='min-w-0 flex-1'
                    />
                    <Button type='submit' disabled={busy}>
                      <Check className='me-2 size-4' />
                      {t('gym.save')}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      disabled={busy}
                      onClick={() => setEditingPlanTitle(false)}
                    >
                      {t('gym.cancel')}
                    </Button>
                  </form>
                ) : (
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-lg font-semibold'>
                        {selectedPlan.title}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {t('gym.planTitle')}
                      </p>
                    </div>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          setPlanTitleDraft(selectedPlan.title)
                          setEditingPlanTitle(true)
                        }}
                      >
                        <Pencil className='me-2 size-4' />
                        {t('gym.editTitle')}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type='button' variant='destructive' size='sm'>
                            <Trash2 className='me-2 size-4' />
                            {t('gym.deletePlan')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t('gym.deletePlanConfirmTitle')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('gym.deletePlanConfirmBody')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              {t('gym.cancel')}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={removePlan}
                              className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
                            >
                              {t('gym.deletePlan')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                )
              ) : (
                <div className='flex flex-col gap-3'>
                  <p className='text-sm text-muted-foreground'>
                    {t('gym.noPlan')}
                  </p>
                  <form
                    onSubmit={createPlan}
                    className='flex flex-wrap items-center gap-2'
                  >
                    <Input
                      value={planTitleDraft}
                      onChange={(event) =>
                        setPlanTitleDraft(event.target.value)
                      }
                      placeholder={t('gym.planTitlePlaceholder')}
                      aria-label={t('gym.planTitle')}
                      className='min-w-0 flex-1'
                    />
                    <Button type='submit' disabled={busy}>
                      <Plus className='me-2 size-4' />
                      {t('gym.createPlan')}
                    </Button>
                  </form>
                </div>
              )}

              <div className='flex flex-col gap-3 border-t pt-4'>
                <h3 className='text-sm font-semibold'>
                  {t('gym.exercisesTitle')}
                </h3>
                {selectedExercises.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('gym.noExercises')}
                  </p>
                ) : (
                  <ul className='flex flex-col gap-2'>
                    {selectedExercises.map((exercise, index) => (
                      <li
                        key={exercise.id}
                        className='flex flex-col gap-2 rounded-md border p-2'
                      >
                        {editingExercise?.id === exercise.id ? (
                          <form
                            onSubmit={renameExercise}
                            className='flex flex-wrap items-center gap-2'
                          >
                            <Input
                              value={editingExercise.name}
                              onChange={(event) =>
                                setEditingExercise({
                                  id: exercise.id,
                                  name: event.target.value,
                                })
                              }
                              aria-label={t('gym.editExercise')}
                              className='min-w-0 flex-1'
                            />
                            <Button type='submit' size='sm' disabled={busy}>
                              <Check className='me-2 size-4' />
                              {t('gym.save')}
                            </Button>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              disabled={busy}
                              onClick={() => setEditingExercise(null)}
                            >
                              {t('gym.cancel')}
                            </Button>
                          </form>
                        ) : (
                          <div className='flex items-center gap-1'>
                            <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                              {exercise.name}
                            </span>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              aria-label={t('gym.moveUp')}
                              disabled={busy || index === 0}
                              onClick={() => moveExercise(exercise.id, 'up')}
                            >
                              <ChevronUp className='size-4' />
                            </Button>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              aria-label={t('gym.moveDown')}
                              disabled={
                                busy || index === selectedExercises.length - 1
                              }
                              onClick={() => moveExercise(exercise.id, 'down')}
                            >
                              <ChevronDown className='size-4' />
                            </Button>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              aria-label={t('gym.editExercise')}
                              onClick={() =>
                                setEditingExercise({
                                  id: exercise.id,
                                  name: exercise.name,
                                })
                              }
                            >
                              <Pencil className='size-4' />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  aria-label={t('gym.deleteExercise')}
                                >
                                  <Trash2 className='size-4 text-destructive' />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t('gym.deleteExerciseConfirmTitle')}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t('gym.deleteExerciseConfirmBody')}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    {t('gym.cancel')}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => removeExercise(exercise.id)}
                                    className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
                                  >
                                    {t('gym.confirm')}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {selectedPlan && (
                  <form
                    onSubmit={addExercise}
                    className='flex flex-wrap items-center gap-2'
                  >
                    <Input
                      value={newExerciseName}
                      onChange={(event) =>
                        setNewExerciseName(event.target.value)
                      }
                      placeholder={t('gym.exercisePlaceholder')}
                      aria-label={t('gym.addExercise')}
                      className='min-w-0 flex-1'
                    />
                    <Button type='submit' variant='outline' disabled={busy}>
                      <Plus className='me-2 size-4' />
                      {t('gym.addExercise')}
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Session logging ---------------------------------------------- */}
        <TabsContent value='session' className='flex flex-col gap-4'>
          <label className='block max-w-xs text-sm font-medium'>
            {t('gym.sessionDate')}
            <JalaliDatePicker
              value={sessionDate}
              onChange={setSessionDate}
              className='mt-2'
              ariaLabel={t('gym.sessionDate')}
            />
          </label>

          {draftSession ? (
            <Card>
              <CardHeader>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='min-w-0'>
                    <CardTitle className='truncate'>
                      {draftSession.title}
                    </CardTitle>
                    <CardDescription>
                      {t('gym.sessionFor', { day: dayLabel(sessionWeekday) })} ·{' '}
                      {formatJalaliDateKey(sessionDate)} ·{' '}
                      {formatTime24(new Date(draftSession.startedAt))}
                    </CardDescription>
                  </div>
                  <Badge variant='secondary'>{t('gym.sessionDraft')}</Badge>
                </div>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                {sessionExercises.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('gym.noExercises')}
                  </p>
                ) : (
                  sessionExercises.map((exercise) => {
                    const exerciseSets = setsOfSession(draftSession.id).filter(
                      (set) => set.exerciseId === exercise.id
                    )
                    const last = exercisePerformance(
                      data,
                      exercise.id,
                      draftSession.id
                    )
                    const draft = setDrafts[exercise.id] ?? {
                      reps: '',
                      weightKg: '',
                    }
                    return (
                      <section
                        key={exercise.id}
                        className='flex flex-col gap-2 rounded-md border p-3'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <h4 className='min-w-0 truncate text-sm font-semibold'>
                            {exercise.name}
                          </h4>
                          {last && (
                            <span className='shrink-0 text-xs text-muted-foreground'>
                              {t('gym.lastPerformance')}:{' '}
                              {t('gym.lastPerformanceDetail', {
                                weight: fmt(last.topWeightKg),
                                reps: fmt(last.topReps),
                                date: formatJalaliDateKey(last.dateKey),
                              })}
                            </span>
                          )}
                        </div>
                        {exerciseSets.length === 0 ? (
                          <p className='text-xs text-muted-foreground'>
                            {t('gym.noSets')}
                          </p>
                        ) : (
                          <ul className='flex flex-col gap-1'>
                            {exerciseSets.map((set) => (
                              <li key={set.id}>
                                {editingSet?.id === set.id ? (
                                  <form
                                    onSubmit={(event) => {
                                      event.preventDefault()
                                      saveEditedSet(set)
                                    }}
                                    className='grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-2'
                                  >
                                    <span className='text-sm tabular-nums'>
                                      {t('gym.set')} {fmt(set.setNumber)}
                                    </span>
                                    <Input
                                      type='number'
                                      min='0'
                                      step='0.5'
                                      inputMode='decimal'
                                      value={editingSet.weightKg}
                                      onChange={(event) =>
                                        setEditingSet({
                                          ...editingSet,
                                          weightKg: event.target.value,
                                        })
                                      }
                                      aria-label={t('gym.weightKg')}
                                      className='h-8 min-w-0'
                                    />
                                    <Input
                                      type='number'
                                      min='1'
                                      step='1'
                                      inputMode='numeric'
                                      value={editingSet.reps}
                                      onChange={(event) =>
                                        setEditingSet({
                                          ...editingSet,
                                          reps: event.target.value,
                                        })
                                      }
                                      aria-label={t('gym.reps')}
                                      className='h-8 min-w-0'
                                    />
                                    <Button
                                      type='submit'
                                      variant='ghost'
                                      size='icon'
                                      aria-label={t('gym.save')}
                                      disabled={busy}
                                    >
                                      <Check className='size-4' />
                                    </Button>
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='icon'
                                      aria-label={t('gym.cancel')}
                                      disabled={busy}
                                      onClick={() => setEditingSet(null)}
                                    >
                                      <X className='size-4' />
                                    </Button>
                                  </form>
                                ) : (
                                  <div className='flex items-center justify-between gap-2 text-sm'>
                                    <span className='tabular-nums'>
                                      {t('gym.set')} {fmt(set.setNumber)}
                                    </span>
                                    <span className='tabular-nums'>
                                      {fmt(set.weightKg)} kg × {fmt(set.reps)}{' '}
                                      {t('gym.reps')}
                                    </span>
                                    <span className='flex gap-1'>
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        aria-label={t('gym.editSet')}
                                        onClick={() =>
                                          setEditingSet({
                                            id: set.id,
                                            reps: String(set.reps),
                                            weightKg: String(set.weightKg),
                                          })
                                        }
                                      >
                                        <Pencil className='size-4' />
                                      </Button>
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        aria-label={t('gym.deleteSet')}
                                        onClick={() => removeSet(set.id)}
                                      >
                                        <Trash2 className='size-4 text-destructive' />
                                      </Button>
                                    </span>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <form
                          onSubmit={(event) => {
                            event.preventDefault()
                            addSet(exercise, draftSession)
                          }}
                          className='grid grid-cols-[1fr_1fr_auto] items-center gap-2'
                        >
                          <Input
                            type='number'
                            min='0'
                            step='0.5'
                            inputMode='decimal'
                            placeholder={t('gym.weightKg')}
                            value={draft.weightKg}
                            onChange={(event) =>
                              setSetDrafts((current) => ({
                                ...current,
                                [exercise.id]: {
                                  reps: draft.reps,
                                  weightKg: event.target.value,
                                },
                              }))
                            }
                            aria-label={t('gym.weightKg')}
                            className='h-9 min-w-0'
                          />
                          <Input
                            type='number'
                            min='1'
                            step='1'
                            inputMode='numeric'
                            placeholder={t('gym.reps')}
                            value={draft.reps}
                            onChange={(event) =>
                              setSetDrafts((current) => ({
                                ...current,
                                [exercise.id]: {
                                  reps: event.target.value,
                                  weightKg: draft.weightKg,
                                },
                              }))
                            }
                            aria-label={t('gym.reps')}
                            className='h-9 min-w-0'
                          />
                          <Button
                            type='submit'
                            variant='outline'
                            size='sm'
                            disabled={busy}
                          >
                            <Plus className='size-4' />
                            {t('gym.addSet')}
                          </Button>
                        </form>
                      </section>
                    )
                  })
                )}
                <p className='text-xs text-muted-foreground'>
                  {t('gym.setsSavedImmediately')}
                </p>
                <div className='flex flex-wrap gap-2 border-t pt-4'>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type='button'
                        disabled={
                          busy || setsOfSession(draftSession.id).length === 0
                        }
                      >
                        <Check className='me-2 size-4' />
                        {t('gym.completeSession')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('gym.completeConfirmTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('gym.completeConfirmBody')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('gym.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => finishSession(draftSession.id)}
                        >
                          {t('gym.confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type='button'
                        variant='destructive'
                        disabled={busy}
                      >
                        <Trash2 className='me-2 size-4' />
                        {t('gym.deleteSession')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('gym.deleteSessionConfirmTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('gym.deleteSessionConfirmBody')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('gym.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => removeSession(draftSession.id)}
                          className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
                        >
                          {t('gym.deleteSession')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ) : sessionPlan ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('gym.sessionFor', { day: dayLabel(sessionWeekday) })}
                </CardTitle>
                <CardDescription>{sessionPlan.title}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type='button' onClick={beginSession} disabled={busy}>
                  <Plus className='me-2 size-4' />
                  {t('gym.startSession')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('gym.noPlanForDate')}
            </p>
          )}

          {doneSessions.length > 0 && (
            <div className='flex flex-col gap-2'>
              <h3 className='text-sm font-semibold'>{t('gym.sessionDone')}</h3>
              {doneSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  sets={setsOfSession(session.id)}
                  expanded={expandedSessionId === session.id}
                  onToggle={() =>
                    setExpandedSessionId(
                      expandedSessionId === session.id ? null : session.id
                    )
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* History -------------------------------------------------------- */}
        <TabsContent value='history' className='flex flex-col gap-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <History className='size-5' />
                {t('gym.sessionHistory')}
              </CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              {data.sessions.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  {t('gym.noSessions')}
                </p>
              ) : (
                data.sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    sets={setsOfSession(session.id)}
                    expanded={expandedSessionId === session.id}
                    onToggle={() =>
                      setExpandedSessionId(
                        expandedSessionId === session.id ? null : session.id
                      )
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Dumbbell className='size-5' />
                {t('gym.exerciseHistory')}
              </CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              <select
                aria-label={t('gym.pickExercise')}
                value={historyExerciseId}
                onChange={(event) => setHistoryExerciseId(event.target.value)}
                className='h-9 w-full rounded-md border bg-background px-2 text-sm'
              >
                <option value=''>{t('gym.pickExercise')}</option>
                {historyExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
              {historyExerciseId ? (
                historyEntries.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('gym.emptyHistory')}
                  </p>
                ) : (
                  <div className='flex flex-col gap-3'>
                    <p className='text-sm'>
                      {t('gym.lastPerformance')}:{' '}
                      {t('gym.lastPerformanceDetail', {
                        weight: fmt(historyEntries[0]!.topWeightKg),
                        reps: fmt(historyEntries[0]!.topReps),
                        date: formatJalaliDateKey(
                          historyEntries[0]!.session.dateKey
                        ),
                      })}
                    </p>
                    <ul className='flex flex-col gap-2'>
                      {historyEntries.map(
                        ({ session, sets, topWeightKg, volumeKg }) => (
                          <li
                            key={session.id}
                            className='rounded-md border p-3'
                          >
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                              <p className='text-sm font-medium'>
                                {formatJalaliDateKey(session.dateKey)}
                              </p>
                              <p className='text-xs text-muted-foreground'>
                                {t('gym.topWeight')}: {fmt(topWeightKg)} kg ·{' '}
                                {t('gym.volume')}: {fmt(volumeKg)}
                              </p>
                            </div>
                            <ul className='mt-2 flex flex-col gap-1'>
                              {sets.map((set) => (
                                <li
                                  key={set.id}
                                  className='flex items-center justify-between gap-2 text-sm tabular-nums'
                                >
                                  <span>
                                    {t('gym.set')} {fmt(set.setNumber)}
                                  </span>
                                  <span>
                                    {fmt(set.weightKg)} kg × {fmt(set.reps)}{' '}
                                    {t('gym.reps')}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('gym.pickExercise')}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
