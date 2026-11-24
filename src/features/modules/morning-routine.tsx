import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import {
  getDashboardDay,
  saveDashboardDay,
  type DashboardDayRecord,
} from '@/services/db'
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
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TimePicker24 } from '@/components/time-picker-24'

function routineSignature(values: {
  sleepTime: string
  wakeTime: string
  bookName: string
  readingMinutes: string
}): string {
  return JSON.stringify(values)
}

function sleepDurationMinutes(
  sleepTime: string,
  wakeTime: string
): number | null {
  if (!sleepTime || !wakeTime) return null
  const [sleepHour, sleepMinute] = sleepTime.split(':').map(Number)
  const [wakeHour, wakeMinute] = wakeTime.split(':').map(Number)
  if (
    [sleepHour, sleepMinute, wakeHour, wakeMinute].some(
      (value) => !Number.isFinite(value)
    )
  ) {
    return null
  }
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
  const [day, setDay] = useState<DashboardDayRecord>(() =>
    emptyRoutine(toDateKey(new Date()))
  )
  const [sleepTime, setSleepTime] = useState('')
  const [wakeTime, setWakeTime] = useState('')
  const [bookName, setBookName] = useState('')
  const [readingMinutes, setReadingMinutes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const lastSavedSignature = useRef('')

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    setLoading(true)
    setError('')
    void getDashboardDay(date)
      .then((record) => {
        if (!active) return
        const next = record ?? emptyRoutine(date)
        setDay(next)
        setSleepTime(next.sleepTime ?? '')
        setWakeTime(next.wakeTime)
        setBookName(next.bookName ?? '')
        setReadingMinutes(
          next.readingMinutes === undefined ? '' : String(next.readingMinutes)
        )
        lastSavedSignature.current = routineSignature({
          sleepTime: next.sleepTime ?? '',
          wakeTime: next.wakeTime,
          bookName: next.bookName ?? '',
          readingMinutes:
            next.readingMinutes === undefined
              ? ''
              : String(next.readingMinutes),
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

  const currentSignature = routineSignature({
    sleepTime,
    wakeTime,
    bookName,
    readingMinutes,
  })

  const buildRecord = (): DashboardDayRecord => {
    const readingValue = readingMinutes.trim()
      ? Number(readingMinutes)
      : undefined
    return {
      // Existing breakfast/commute/bag fields are kept untouched; only the
      // routine fields this page owns are written.
      ...day,
      dateKey: date,
      sleepTime: sleepTime || undefined,
      wakeTime,
      bookName: bookName.trim() || undefined,
      readingMinutes: readingValue,
    }
  }

  const validate = (): boolean => {
    const readingValue = readingMinutes.trim()
      ? Number(readingMinutes)
      : undefined
    if (
      readingValue !== undefined &&
      (!Number.isInteger(readingValue) || readingValue < 0)
    ) {
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

  // Autosave after a short pause so a refresh never loses the edited routine.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature captures every edited field
  }, [currentSignature, loading, date])

  const sleepMinutes = sleepDurationMinutes(sleepTime, wakeTime)

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
          <p role='status' className='text-sm text-muted-foreground'>
            {t('routine.loading')}
          </p>
        ) : (
          <form
            onSubmit={(event) => void save(event)}
            className='grid gap-4 lg:grid-cols-2'
          >
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
                {sleepMinutes !== null ? (
                  <p className='rounded-md bg-muted/50 p-3 text-sm sm:col-span-2'>
                    {t('routine.sleepDuration', {
                      hours: Math.floor(sleepMinutes / 60),
                      minutes: sleepMinutes % 60,
                    })}
                  </p>
                ) : null}
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

            <div className='flex flex-wrap items-center gap-3 lg:col-span-2'>
              <Button type='submit' disabled={saving}>
                <Save className='me-2 size-4' />
                {t(saving ? 'routine.saving' : 'routine.save')}
              </Button>
              {saved ? (
                <Badge variant='secondary'>{t('routine.saved')}</Badge>
              ) : null}
              {error ? (
                <p role='alert' className='text-sm text-destructive'>
                  {error}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </Main>
    </>
  )
}
