import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Plus, Save, Trash2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { createId } from '@/lib/id'
import { toDateKey } from '@/lib/date-key'
import { getDashboardDay, getMealLogs, saveDashboardDay, type DashboardDayRecord, type MealLog } from '@/services/db'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { TimePicker24 } from '@/components/time-picker-24'

function routineSignature(values: {
  sleepTime: string
  wakeTime: string
  breakfast: string
  breakfastCalories: string
  caloriesConfirmed: boolean
  bookName: string
  readingMinutes: string
  commuteTime: string
  bagItems: DashboardDayRecord['bagItems']
}): string {
  return JSON.stringify(values)
}

function sleepDurationMinutes(sleepTime: string, wakeTime: string): number | null {
  if (!sleepTime || !wakeTime) return null
  const [sleepHour, sleepMinute] = sleepTime.split(':').map(Number)
  const [wakeHour, wakeMinute] = wakeTime.split(':').map(Number)
  if ([sleepHour, sleepMinute, wakeHour, wakeMinute].some((value) => !Number.isFinite(value))) return null
  let minutes = wakeHour * 60 + wakeMinute - (sleepHour * 60 + sleepMinute)
  if (minutes < 0) minutes += 24 * 60
  return minutes
}

function emptyRoutine(dateKey: string): DashboardDayRecord {
  return {
    dateKey,
    wakeTime: '',
    breakfast: '',
    bagItems: [],
    commuteTime: '',
    note: '',
    updatedAt: '',
  }
}

export function MorningRoutinePage() {
  const { t } = useTranslation()
  const [date, setDate] = useState(toDateKey(new Date()))
  const [day, setDay] = useState<DashboardDayRecord>(() => emptyRoutine(toDateKey(new Date())))
  const [sleepTime, setSleepTime] = useState('')
  const [wakeTime, setWakeTime] = useState('')
  const [breakfast, setBreakfast] = useState('')
  const [breakfastCalories, setBreakfastCalories] = useState('')
  const [caloriesConfirmed, setCaloriesConfirmed] = useState(false)
  const [bookName, setBookName] = useState('')
  const [readingMinutes, setReadingMinutes] = useState('')
  const [commuteTime, setCommuteTime] = useState('')
  const [newBagItem, setNewBagItem] = useState('')
  const [meals, setMeals] = useState<MealLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const lastSavedSignature = useRef('')

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    setLoading(true)
    setError('')
    void Promise.all([getDashboardDay(date), getMealLogs(date)])
      .then(([record, dayMeals]) => {
        if (!active) return
        setMeals(dayMeals)
        const next = record ?? emptyRoutine(date)
        setDay(next)
        setSleepTime(next.sleepTime ?? '')
        setWakeTime(next.wakeTime)
        setBreakfast(next.breakfast)
        setBreakfastCalories(next.breakfastCalories === undefined ? '' : String(next.breakfastCalories))
        setCaloriesConfirmed(next.breakfastCaloriesIsConfirmed === true)
        setBookName(next.bookName ?? '')
        setReadingMinutes(next.readingMinutes === undefined ? '' : String(next.readingMinutes))
        setCommuteTime(next.commuteTime)
        lastSavedSignature.current = routineSignature({
          sleepTime: next.sleepTime ?? '',
          wakeTime: next.wakeTime,
          breakfast: next.breakfast,
          breakfastCalories: next.breakfastCalories === undefined ? '' : String(next.breakfastCalories),
          caloriesConfirmed: next.breakfastCaloriesIsConfirmed === true,
          bookName: next.bookName ?? '',
          readingMinutes: next.readingMinutes === undefined ? '' : String(next.readingMinutes),
          commuteTime: next.commuteTime,
          bagItems: next.bagItems,
        })
      })
      .catch(() => {
        if (active) setError(t('routine.loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [date, t])

  const addBagItem = () => {
    const label = newBagItem.trim()
    if (!label) return
    setDay((current) => ({
      ...current,
      bagItems: [...current.bagItems, { id: createId('bag'), label, checked: false }],
    }))
    setNewBagItem('')
  }

  const currentSignature = routineSignature({ sleepTime, wakeTime, breakfast, breakfastCalories, caloriesConfirmed, bookName, readingMinutes, commuteTime, bagItems: day.bagItems })

  const buildRecord = (): DashboardDayRecord => {
    const calorieValue = breakfastCalories.trim() ? Number(breakfastCalories) : undefined
    const readingValue = readingMinutes.trim() ? Number(readingMinutes) : undefined
    return {
      ...day,
      dateKey: date,
      sleepTime: sleepTime || undefined,
      wakeTime,
      breakfast,
      breakfastCalories: calorieValue,
      breakfastCaloriesIsConfirmed: calorieValue === undefined ? undefined : caloriesConfirmed,
      bookName: bookName.trim() || undefined,
      readingMinutes: readingValue,
      commuteTime,
    }
  }

  const validate = (): boolean => {
    const calorieValue = breakfastCalories.trim() ? Number(breakfastCalories) : undefined
    const readingValue = readingMinutes.trim() ? Number(readingMinutes) : undefined
    if (calorieValue !== undefined && (!Number.isFinite(calorieValue) || calorieValue < 0)) {
      setError(t('routine.invalidCalories'))
      return false
    }
    if (readingValue !== undefined && (!Number.isInteger(readingValue) || readingValue < 0)) {
      setError(t('routine.invalidMinutes'))
      return false
    }
    return true
  }

  const save = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setError('')
    setSaved(false)
    if (!validate()) return
    setSaving(true)
    try {
      const record = await saveDashboardDay(buildRecord())
      setDay(record)
      lastSavedSignature.current = currentSignature
      setSaved(true)
    } catch {
      setError(t('routine.saveError'))
    } finally {
      setSaving(false)
    }
  }

  // Every field is autosaved after a short pause, so a refresh never loses a
  // checked bag item, bedtime, calorie confirmation, or departure time.
  useEffect(() => {
    if (loading || currentSignature === lastSavedSignature.current) return
    const timer = window.setTimeout(() => {
      void saveDashboardDay(buildRecord())
        .then((record) => {
          setDay(record)
          lastSavedSignature.current = currentSignature
          setSaved(true)
        })
        .catch(() => setError(t('routine.saveError')))
    }, 600)
    return () => window.clearTimeout(timer)
  }, [currentSignature, loading, date])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const sleepMinutes = sleepDurationMinutes(sleepTime, wakeTime)
  const commuteMs = (() => {
    if (!commuteTime || date !== toDateKey(new Date())) return null
    const [hour, minute] = commuteTime.split(':').map(Number)
    const target = new Date()
    target.setHours(hour, minute, 0, 0)
    return target.getTime() - now
  })()

  const updateBagItem = (id: string, patch: Partial<DashboardDayRecord['bagItems'][number]>) => {
    setDay((current) => ({
      ...current,
      bagItems: current.bagItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('routine.title')}</h2>
          <p className='text-muted-foreground'>{t('routine.hint')}</p>
        </div>

        <label className='block max-w-xs text-sm font-medium'>
          {t('routine.date')}
          <JalaliDatePicker
            value={date}
            onChange={setDate}
            className='mt-2'
            ariaLabel={t('routine.date')}
          />
        </label>

        {loading ? (
          <p role='status' className='text-sm text-muted-foreground'>{t('routine.loading')}</p>
        ) : (
          <form onSubmit={(event) => void save(event)} className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('routine.sleepTitle')}</CardTitle>
                <CardDescription>{t('routine.sleepHint')}</CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3 sm:grid-cols-2'>
                <label className='text-sm font-medium'>
                  {t('routine.sleepTime')}
                  <TimePicker24
                    value={sleepTime}
                    onChange={setSleepTime}
                    className='mt-2'
                    clearable
                  />
                </label>
                <label className='text-sm font-medium'>
                  {t('routine.wakeTime')}
                  <TimePicker24
                    value={wakeTime}
                    onChange={setWakeTime}
                    className='mt-2'
                    clearable
                  />
                </label>
                {sleepMinutes !== null && (
                  <p className='sm:col-span-2 rounded-md bg-muted/50 p-3 text-sm'>
                    {t('routine.sleepDuration', { hours: Math.floor(sleepMinutes / 60), minutes: sleepMinutes % 60 })}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('routine.breakfastTitle')}</CardTitle>
                <CardDescription>{t('routine.breakfastHint')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                {meals.filter((meal) => meal.kind === 'breakfast').length ? (
                  meals
                    .filter((meal) => meal.kind === 'breakfast')
                    .map((meal) => (
                      <p key={meal.id} className='text-sm'>
                        {meal.description} · {meal.calories} kcal
                      </p>
                    ))
                ) : (
                  <p className='text-sm text-muted-foreground'>{t('routine.noBreakfast')}</p>
                )}
                <a className='inline-block text-sm text-primary underline' href='/nutrition'>
                  {t('routine.openNutrition')}
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <BookOpen className='size-5' />
                  {t('routine.readingTitle')}
                </CardTitle>
                <CardDescription>{t('routine.readingHint')}</CardDescription>
              </CardHeader>
              <CardContent className='grid gap-3 sm:grid-cols-2'>
                <Input
                  value={bookName}
                  onChange={(event) => setBookName(event.target.value)}
                  placeholder={t('routine.bookPlaceholder')}
                />
                <Input
                  type='number'
                  min='0'
                  step='1'
                  value={readingMinutes}
                  onChange={(event) => setReadingMinutes(event.target.value)}
                  placeholder={t('routine.readingMinutes')}
                  aria-label={t('routine.readingMinutes')}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('routine.departureTitle')}</CardTitle>
                <CardDescription>{t('routine.departureHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <label className='block max-w-xs text-sm font-medium'>
                  {t('routine.commuteTime')}
                  <TimePicker24
                    value={commuteTime}
                    onChange={setCommuteTime}
                    className='mt-2'
                    clearable
                  />
                </label>
                {commuteMs !== null && (
                  <p className={`mt-3 text-sm ${commuteMs <= 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {commuteMs > 0
                      ? t('routine.commuteRemaining', {
                          hours: Math.floor(commuteMs / 3_600_000),
                          minutes: Math.floor((commuteMs % 3_600_000) / 60_000),
                          seconds: Math.floor((commuteMs % 60_000) / 1_000),
                        })
                      : t('routine.departurePassed')}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle>{t('routine.bagTitle')}</CardTitle>
                <CardDescription>{t('routine.bagHint')}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                {day.bagItems.length ? (
                  day.bagItems.map((item) => (
                    <div key={item.id} className='flex items-center gap-3'>
                      <Checkbox
                        checked={item.checked}
                        onCheckedChange={(checked) => updateBagItem(item.id, { checked: checked === true })}
                      />
                      <Input
                        value={item.label}
                        onChange={(event) => updateBagItem(item.id, { label: event.target.value })}
                        aria-label={t('routine.bagItem')}
                      />
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        aria-label={t('routine.removeItem')}
                        onClick={() =>
                          setDay((current) => ({
                            ...current,
                            bagItems: current.bagItems.filter((entry) => entry.id !== item.id),
                          }))
                        }
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className='text-sm text-muted-foreground'>{t('routine.emptyBag')}</p>
                )}
                <div className='flex gap-2'>
                  <Input
                    value={newBagItem}
                    onChange={(event) => setNewBagItem(event.target.value)}
                    placeholder={t('routine.bagItem')}
                  />
                  <Button type='button' variant='outline' onClick={addBagItem}>
                    <Plus className='me-2 size-4' />
                    {t('routine.addItem')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className='flex flex-wrap items-center gap-3 lg:col-span-2'>
              <Button type='submit' disabled={saving}>
                <Save className='me-2 size-4' />
                {t(saving ? 'routine.saving' : 'routine.save')}
              </Button>
              {saved && <Badge variant='secondary'>{t('routine.saved')}</Badge>}
              {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
            </div>
          </form>
        )}
      </Main>
    </>
  )
}
