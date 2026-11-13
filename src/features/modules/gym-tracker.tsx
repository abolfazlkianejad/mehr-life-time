import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Dumbbell, HeartPulse, Scale, Sparkles, Trash2, TrendingDown, TrendingUp, LoaderCircle } from 'lucide-react'
import { subDays } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import {
  deleteWorkoutSet,
  getBodyWeight,
  getBodyWeightsByRange,
  getVitals,
  getVitalsByRange,
  getWorkoutLogs,
  getWorkoutLogsByRange,
  saveBodyWeight,
  saveVital,
  saveWorkoutSet,
  type BodyWeightRecord,
  type VitalRecord,
  type WorkoutSet,
} from '@/services/db'
import { getCardioLogs } from '@/services/nutrition'
import { isAiConfigured, requestAiText } from '@/features/ai/client'
import { formatJalaliDateKey } from '@/lib/jalali'
import { toDateKey } from '@/lib/date-key'

function pressureStatus(v: Pick<VitalRecord, 'systolic' | 'diastolic'>): 'high' | 'low' | 'normal' {
  return v.systolic >= 140 || v.diastolic >= 90 ? 'high' : v.systolic < 90 || v.diastolic < 60 ? 'low' : 'normal'
}

interface ExerciseProgress {
  exercise: string
  latestDate?: string
  previousDate?: string
  latestVolume: number
  previousVolume: number
  latestTopWeight: number
  previousTopWeight: number
  latestTopReps: number
  latestRir: number
}

function volumeOf(sets: WorkoutSet[]): number {
  return sets.reduce((total, set) => total + set.weightKg * set.reps, 0)
}
function topSet(sets: WorkoutSet[]): WorkoutSet | undefined {
  return [...sets].sort((a, b) => b.weightKg - a.weightKg || b.reps - a.reps)[0]
}

export function GymTracker() {
  const { t } = useTranslation()
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [history, setHistory] = useState<WorkoutSet[]>([])
  const [vitals, setVitals] = useState<VitalRecord[]>([])
  const [vitalHistory, setVitalHistory] = useState<VitalRecord[]>([])
  const [weights, setWeights] = useState<BodyWeightRecord[]>([])
  const [weight, setWeight] = useState('')
  const [currentWeight, setCurrentWeight] = useState<number | null>(null)
  const [exercise, setExercise] = useState('')
  const [workoutDate, setWorkoutDate] = useState(() => toDateKey(new Date()))
  const [form, setForm] = useState({ set: 1, weightKg: 0, reps: 8, rir: 2 })
  const [pressure, setPressure] = useState({ systolic: '', diastolic: '', pulse: '' })
  const [burnedToday, setBurnedToday] = useState(0)
  const [analysis, setAnalysis] = useState('')
  const [analysing, setAnalysing] = useState(false)
  const [error, setError] = useState('')

  async function reload() {
    const now = new Date()
    const [todaySets, rangeSets, todayVitals, rangeVitals, todayWeight, rangeWeights, cardio] = await Promise.all([
      getWorkoutLogs(now),
      getWorkoutLogsByRange(subDays(now, 60), now),
      getVitals(now),
      getVitalsByRange(subDays(now, 30), now),
      getBodyWeight(now),
      getBodyWeightsByRange(subDays(now, 90), now),
      getCardioLogs(now),
    ])
    setSets(todaySets)
    setHistory(rangeSets)
    setVitals(todayVitals)
    setVitalHistory(rangeVitals)
    setWeights(rangeWeights)
    if (todayWeight) {
      setCurrentWeight(todayWeight.weightKg)
      setWeight(String(todayWeight.weightKg))
    }
    setBurnedToday(cardio.reduce((sum, session) => sum + session.calories, 0))
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    void reload().catch(() => setError(t('health.loadError')))
  }, [t])

  async function addSet(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!exercise.trim() || !Number.isFinite(form.weightKg) || form.weightKg < 0 || form.reps < 1) {
      setError(t('health.invalidSet'))
      return
    }
    try {
      await saveWorkoutSet({ ...form, exercise: exercise.trim(), date: workoutDate })
      setForm((current) => ({ ...current, set: current.set + 1 }))
      await reload()
    } catch {
      setError(t('health.invalidSet'))
    }
  }

  async function removeSet(set: WorkoutSet) {
    try {
      await deleteWorkoutSet(set.id)
      await reload()
    } catch {
      setError(t('health.loadError'))
    }
  }

  async function addVital(period: 'morning' | 'evening') {
    setError('')
    const systolic = Number(pressure.systolic)
    const diastolic = Number(pressure.diastolic)
    const pulse = pressure.pulse.trim() ? Number(pressure.pulse) : 0
    if (!Number.isInteger(systolic) || !Number.isInteger(diastolic) || systolic < 50 || systolic > 300 || diastolic < 30 || diastolic > 200 || !Number.isInteger(pulse) || pulse < 0 || pulse > 250) {
      setError(t('health.invalidVital'))
      return
    }
    try {
      await saveVital({ period, systolic, diastolic, pulse })
      setPressure({ systolic: '', diastolic: '', pulse: '' })
      await reload()
    } catch {
      setError(t('health.invalidVital'))
    }
  }

  async function saveWeight() {
    setError('')
    const parsed = Number(weight)
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      setError(t('health.invalidWeight'))
      return
    }
    try {
      const record = await saveBodyWeight(parsed)
      setCurrentWeight(record.weightKg)
      await reload()
    } catch {
      setError(t('health.invalidWeight'))
    }
  }

  const progress = useMemo<ExerciseProgress[]>(() => {
    const byExercise = new Map<string, WorkoutSet[]>()
    for (const set of history) {
      const list = byExercise.get(set.exercise) ?? []
      list.push(set)
      byExercise.set(set.exercise, list)
    }
    return [...byExercise.entries()]
      .map(([name, rows]) => {
        const dates = [...new Set(rows.map((row) => row.dateKey))].sort().reverse()
        const latestDate = dates[0]
        const previousDate = dates[1]
        const latestRows = rows.filter((row) => row.dateKey === latestDate)
        const previousRows = previousDate ? rows.filter((row) => row.dateKey === previousDate) : []
        const latestTop = topSet(latestRows)
        const previousTop = topSet(previousRows)
        return {
          exercise: name,
          latestDate,
          previousDate,
          latestVolume: volumeOf(latestRows),
          previousVolume: volumeOf(previousRows),
          latestTopWeight: latestTop?.weightKg ?? 0,
          previousTopWeight: previousTop?.weightKg ?? 0,
          latestTopReps: latestTop?.reps ?? 0,
          latestRir: latestTop?.rir ?? 0,
        }
      })
      .sort((a, b) => a.exercise.localeCompare(b.exercise))
  }, [history])

  const vitalDays = useMemo(() => {
    const byDate = new Map<string, { morning?: VitalRecord; evening?: VitalRecord }>()
    for (const reading of vitalHistory) {
      const row = byDate.get(reading.dateKey) ?? {}
      if (reading.period === 'morning') row.morning = reading
      else row.evening = reading
      byDate.set(reading.dateKey, row)
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
  }, [vitalHistory])

  const weightTrend = useMemo(() => {
    if (weights.length < 2) return null
    const sorted = [...weights].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    return { first, last, delta: last.weightKg - first.weightKg }
  }, [weights])

  const runAnalysis = async () => {
    setError('')
    setAnalysis('')
    setAnalysing(true)
    const lines = [
      `Exercises (volume, top weight x reps): ${progress
        .map((row) => `${row.exercise}: ${row.latestVolume}kg vs ${row.previousVolume}kg, top ${row.latestTopWeight}kg x ${row.latestTopReps}`)
        .join(' | ') || 'none'}`,
      `Body weight: ${weightTrend ? `${weightTrend.last.weightKg}kg on ${weightTrend.last.dateKey}, change ${weightTrend.delta.toFixed(1)}kg since ${weightTrend.first.dateKey}` : 'not enough data'}`,
      `Sessions in the last 60 days: ${history.length} sets`,
    ].join('\n')
    const local = progress.length
      ? t('health.analysis.local', {
          count: progress.length,
          delta: progress.reduce((sum, row) => sum + (row.latestVolume - row.previousVolume), 0).toFixed(0),
        })
      : t('health.analysis.noData')
    if (!isAiConfigured()) {
      setAnalysis(local)
      setAnalysing(false)
      return
    }
    try {
      const text = await requestAiText(
        [
          'Analyze this training log and give short, practical observations.',
          lines,
          'Never change or create training records; only comment on the data.',
        ].join('\n'),
        { system: 'You are a careful strength-training analyst. You never modify or create training data.' }
      )
      setAnalysis(`${local}\n\n${text}`)
    } catch {
      setAnalysis(`${local}\n\n${t('health.analysis.aiUnavailable')}`)
    } finally {
      setAnalysing(false)
    }
  }

  const pressureForm = (
    <div className='grid grid-cols-3 gap-2'>
      <Input aria-label={t('health.systolic')} type='number' placeholder={t('health.systolic')} value={pressure.systolic} onChange={(event) => setPressure({ ...pressure, systolic: event.target.value })} />
      <Input aria-label={t('health.diastolic')} type='number' placeholder={t('health.diastolic')} value={pressure.diastolic} onChange={(event) => setPressure({ ...pressure, diastolic: event.target.value })} />
      <Input aria-label={t('health.pulse')} type='number' placeholder={t('health.pulse')} value={pressure.pulse} onChange={(event) => setPressure({ ...pressure, pulse: event.target.value })} />
    </div>
  )

  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      {error && <p role='alert' className='text-sm text-destructive lg:col-span-2'>{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'><Dumbbell className='size-5' />{t('health.workout')}</CardTitle>
          <CardDescription>{t('health.progressive')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <form className='grid gap-2 sm:grid-cols-2' onSubmit={(event) => void addSet(event)}>
            <Input required value={exercise} onChange={(event) => setExercise(event.target.value)} placeholder={t('health.exercise')} />
            <JalaliDatePicker value={workoutDate} onChange={setWorkoutDate} ariaLabel={t('health.workoutDate')} />
            <Input type='number' min='1' value={form.set} aria-label={t('health.set')} onChange={(event) => setForm({ ...form, set: Number(event.target.value) })} />
            <Input type='number' min='0' step='.5' value={form.weightKg} aria-label={t('health.weightKg')} onChange={(event) => setForm({ ...form, weightKg: Number(event.target.value) })} />
            <Input type='number' min='1' value={form.reps} aria-label={t('health.reps')} onChange={(event) => setForm({ ...form, reps: Number(event.target.value) })} />
            <Input type='number' min='0' max='10' value={form.rir} aria-label='RIR' onChange={(event) => setForm({ ...form, rir: Number(event.target.value) })} />
            <Button type='submit' className='sm:col-span-2'>{t('health.logSet')}</Button>
          </form>
          <div className='space-y-2'>
            {sets.map((set) => <div key={set.id} className='flex items-center justify-between gap-2 rounded-md border p-2 text-sm'><span>{set.exercise} · {t('health.set')} {set.set}</span><span className='flex items-center gap-2'>{set.weightKg} kg × {set.reps} · RIR {set.rir}<Button size='icon' variant='ghost' aria-label={t('health.deleteSet')} onClick={() => void removeSet(set)}><Trash2 className='size-4' /></Button></span></div>)}
            {!sets.length && <p className='text-sm text-muted-foreground'>{t('health.noSets')}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'><TrendingUp className='size-5' />{t('health.overloadTitle')}</CardTitle>
          <CardDescription>{t('health.overloadHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {progress.length ? (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[560px] text-sm'>
                <thead><tr className='border-b text-start text-muted-foreground'><th className='py-2 text-start'>{t('health.exercise')}</th><th className='text-start'>{t('health.latest')}</th><th className='text-start'>{t('health.previous')}</th><th className='text-start'>{t('health.delta')}</th></tr></thead>
                <tbody>{progress.map((item) => {
                  const delta = item.latestVolume - item.previousVolume
                  return <tr key={item.exercise} className='border-b last:border-0'>
                    <td className='py-2 font-medium'>{item.exercise}</td>
                    <td className='py-2'>{item.latestDate ? formatJalaliDateKey(item.latestDate) : '—'}<br /><span className='text-xs text-muted-foreground'>{item.latestTopWeight} kg × {item.latestTopReps} · RIR {item.latestRir} · {item.latestVolume.toFixed(0)} kg</span></td>
                    <td className='py-2'>{item.previousDate ? formatJalaliDateKey(item.previousDate) : '—'}<br /><span className='text-xs text-muted-foreground'>{item.previousTopWeight} kg · {item.previousVolume.toFixed(0)} kg</span></td>
                    <td className='py-2'><Badge variant={delta >= 0 ? 'secondary' : 'outline'} className='gap-1'>{delta >= 0 ? <TrendingUp className='size-3.5' /> : <TrendingDown className='size-3.5' />}{delta >= 0 ? '+' : ''}{delta.toFixed(0)} kg</Badge></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          ) : <p className='text-sm text-muted-foreground'>{t('health.noHistory')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'><HeartPulse className='size-5' />{t('health.vitals')}</CardTitle>
          <CardDescription>{t('health.adaptive')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {(['morning', 'evening'] as const).map((period) => (
            <div key={period} className='space-y-2 rounded-md border p-3'>
              <p className='text-sm font-medium'>{t(`health.${period}`)}</p>
              {pressureForm}
              <Button size='sm' onClick={() => void addVital(period)}>{t('health.saveReading')}</Button>
            </div>
          ))}
          <div className='space-y-2'>
            {vitals.map((value) => <div key={value.id} className='flex flex-wrap justify-between gap-2 border-b py-2 text-sm'><span>{t(`health.${value.period}`)} · {value.systolic}/{value.diastolic} mmHg · {value.pulse} bpm</span><Badge variant={pressureStatus(value) === 'normal' ? 'secondary' : 'destructive'}>{t(`health.${pressureStatus(value)}`)}</Badge></div>)}
          </div>
          <div>
            <p className='mb-2 text-sm font-medium'>{t('health.vitalHistory')}</p>
            {vitalDays.length ? <div className='overflow-x-auto'><table className='w-full min-w-[480px] text-sm'><thead><tr className='border-b text-muted-foreground'><th className='py-2 text-start'>{t('health.date')}</th><th className='text-start'>{t('health.morning')}</th><th className='text-start'>{t('health.evening')}</th></tr></thead><tbody>{vitalDays.map(([dateKey, row]) => <tr key={dateKey} className='border-b last:border-0'><td className='py-2'>{formatJalaliDateKey(dateKey)}</td><td className='py-2'>{row.morning ? `${row.morning.systolic}/${row.morning.diastolic}` : '—'}</td><td className='py-2'>{row.evening ? `${row.evening.systolic}/${row.evening.diastolic}` : '—'}</td></tr>)}</tbody></table></div> : <p className='text-sm text-muted-foreground'>{t('health.noVitalHistory')}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'><Scale className='size-5' />{t('health.weightTitle')}</CardTitle>
          <CardDescription>{t('health.weightHint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex gap-2'>
            <Input type='number' min='20' max='400' step='.1' value={weight} onChange={(event) => setWeight(event.target.value)} placeholder={t('health.weightKg')} />
            <Button variant='outline' onClick={() => void saveWeight()}>{t('health.saveWeight')}</Button>
          </div>
          {currentWeight !== null && <p className='flex items-center gap-2 text-sm'><Scale className='size-4' />{t('health.todayWeight')}: {currentWeight} kg</p>}
          {weightTrend ? (
            <p className='text-sm'>
              {t('health.weightTrend', {
                from: weightTrend.first.weightKg,
                to: weightTrend.last.weightKg,
                delta: weightTrend.delta.toFixed(1),
              })}
            </p>
          ) : null}
          {weights.length ? <div className='overflow-x-auto'><table className='w-full text-sm'><thead><tr className='border-b text-muted-foreground'><th className='py-2 text-start'>{t('health.date')}</th><th className='text-start'>{t('health.weightKg')}</th></tr></thead><tbody>{[...weights].reverse().slice(0, 14).map((row) => <tr key={row.dateKey} className='border-b last:border-0'><td className='py-2'>{formatJalaliDateKey(row.dateKey)}</td><td className='py-2'>{row.weightKg} kg</td></tr>)}</tbody></table></div> : <p className='text-sm text-muted-foreground'>{t('health.noWeightHistory')}</p>}
        </CardContent>
      </Card>

      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'><Sparkles className='size-5' />{t('health.analysisTitle')}</CardTitle>
          <CardDescription>{t('health.analysisHint')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-center gap-3'>
            <Button variant='outline' disabled={analysing} onClick={() => void runAnalysis()}>
              {analysing ? <LoaderCircle className='me-2 size-4 animate-spin' /> : <Sparkles className='me-2 size-4' />}
              {t('health.runAnalysis')}
            </Button>
            <span className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Activity className='size-4' />
              {t('health.burnedToday', { calories: burnedToday })}
              <a className='text-primary underline' href='/nutrition'>{t('health.openNutrition')}</a>
            </span>
          </div>
          {analysis ? <p className='whitespace-pre-wrap rounded-md border p-3 text-sm'>{analysis}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

export function QuickVitals() {
  const { t } = useTranslation()
  const [vitals, setVitals] = useState<VitalRecord[]>([])
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  useEffect(() => { void getVitals().then(setVitals).catch(() => undefined) }, [])
  const save = async (period: 'morning' | 'evening') => {
    const s = Number(systolic)
    const d = Number(diastolic)
    if (!Number.isInteger(s) || !Number.isInteger(d) || s < 50 || d < 30) return
    const value = await saveVital({ period, systolic: s, diastolic: d, pulse: 0 })
    setVitals((all) => [...all, value])
    setSystolic('')
    setDiastolic('')
  }
  return <Card><CardHeader><CardTitle className='flex items-center gap-2'><HeartPulse className='size-5' />{t('health.quickVitals')}</CardTitle></CardHeader><CardContent className='space-y-3'><div className='grid grid-cols-2 gap-2'><Input type='number' value={systolic} onChange={(event) => setSystolic(event.target.value)} placeholder={t('health.systolic')} /><Input type='number' value={diastolic} onChange={(event) => setDiastolic(event.target.value)} placeholder={t('health.diastolic')} /></div><div className='flex gap-2'><Button size='sm' onClick={() => void save('morning')}>{t('health.morning')}</Button><Button size='sm' variant='outline' onClick={() => void save('evening')}>{t('health.evening')}</Button></div>{vitals.slice(-2).map((value) => <p key={value.id} className='text-xs text-muted-foreground'>{t(`health.${value.period}`)}: {value.systolic}/{value.diastolic} · {t(`health.${pressureStatus(value)}`)}</p>)}<a className='text-sm text-primary underline' href='/gym'>{t('health.openTracker')}</a></CardContent></Card>
}

export function WorkoutSummary() {
  const { t } = useTranslation()
  const [sets, setSets] = useState<WorkoutSet[]>([])
  useEffect(() => { void getWorkoutLogs().then(setSets).catch(() => undefined) }, [])
  return <Card><CardHeader><CardTitle className='flex items-center gap-2'><Dumbbell className='size-5' />{t('health.workout')}</CardTitle></CardHeader><CardContent><p className='text-sm'>{t('health.todaySets', { count: sets.length })}</p>{sets.slice(-2).map((set) => <p key={set.id} className='mt-2 text-xs text-muted-foreground'>{set.exercise}: {set.weightKg}kg × {set.reps} · RIR {set.rir}</p>)}<a className='mt-3 inline-block text-sm text-primary underline' href='/gym'>{t('health.openTracker')}</a></CardContent></Card>
}
