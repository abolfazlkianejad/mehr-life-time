import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/header-actions'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { TimePicker24 } from '@/components/time-picker-24'
import { deleteEnergyLog, getEnergyLogsByDate, saveEnergyLog, updateEnergyLog } from '@/services/db'
import type { EnergyLogRecord } from '@/types/timeline'
import { toDateKey } from '@/lib/date-key'
import { clockDateFromParts, clockTimeFromDate, formatClockTime } from '@/lib/time'

export function EnergyLogPage() {
  const { t, i18n } = useTranslation()
  const [date, setDate] = useState(toDateKey(new Date()))
  const [time, setTime] = useState(() => clockTimeFromDate(new Date()))
  const [score, setScore] = useState<number>(3)
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [logs, setLogs] = useState<EnergyLogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const reload = async (forDate: string) => {
    setLoading(true)
    setError('')
    try {
      setLogs(await getEnergyLogsByDate(forDate))
    } catch {
      setError(t('energy.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    void reload(date)
  }, [date, t])

  const resetForm = () => {
    setEditingId(null)
    setTime(clockTimeFromDate(new Date()))
    setScore(3)
    setNote('')
    setSaved(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    const parsed = clockDateFromParts(date, time)
    if (!parsed) {
      setError(t('energy.invalidTime'))
      return
    }
    setSaving(true)
    try {
      const input = { timestamp: parsed, score: score as 1 | 2 | 3 | 4 | 5, note: note.trim() }
      if (editingId) await updateEnergyLog(editingId, input)
      else await saveEnergyLog(input)
      await reload(date)
      resetForm()
      setSaved(true)
    } catch {
      setError(t('energy.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const edit = (log: EnergyLogRecord) => {
    setEditingId(log.id)
    setTime(clockTimeFromDate(new Date(log.timestamp)))
    setScore(log.score)
    setNote(log.note)
    setSaved(false)
  }

  const remove = async (log: EnergyLogRecord) => {
    try {
      await deleteEnergyLog(log.id)
      setLogs((current) => current.filter((entry) => entry.id !== log.id))
      if (editingId === log.id) resetForm()
    } catch {
      setError(t('energy.deleteError'))
    }
  }

  const average = logs.length
    ? (logs.reduce((total, log) => total + log.score, 0) / logs.length).toFixed(1)
    : null

  return (
    <>
      <Header fixed><HeaderActions /></Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('energy.title')}</h2>
          <p className='text-muted-foreground'>{t('energy.hint')}</p>
        </div>

        <label className='block max-w-xs text-sm font-medium'>
          {t('energy.date')}
          <JalaliDatePicker value={date} onChange={setDate} className='mt-2' ariaLabel={t('energy.date')} />
        </label>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {editingId ? <Pencil className='size-5' /> : <Plus className='size-5' />}
              {t(editingId ? 'energy.editTitle' : 'energy.addTitle')}
            </CardTitle>
            <CardDescription>{t('energy.scaleHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className='grid gap-4 md:grid-cols-2' onSubmit={(event) => void submit(event)}>
              <label className='block text-sm font-medium'>
                {t('energy.time')}
                <TimePicker24
                  value={time}
                  onChange={setTime}
                  className='mt-2'
                  ariaLabel={t('energy.time')}
                />
              </label>
              <fieldset className='space-y-2'>
                <legend className='text-sm font-medium'>{t('energy.score')}</legend>
                <div className='flex flex-wrap gap-2'>
                  {([1, 2, 3, 4, 5] as const).map((value) => (
                    <Button
                      key={value}
                      type='button'
                      size='sm'
                      variant={score === value ? 'default' : 'outline'}
                      aria-pressed={score === value}
                      onClick={() => setScore(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <Textarea
                className='md:col-span-2'
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('energy.notePlaceholder')}
              />
              <div className='flex flex-wrap items-center gap-2 md:col-span-2'>
                <Button type='submit' disabled={saving}>
                  <Save className='me-2 size-4' />
                  {t(saving ? 'energy.saving' : editingId ? 'energy.update' : 'energy.save')}
                </Button>
                {editingId && <Button type='button' variant='outline' onClick={resetForm}><X className='me-2 size-4' />{t('energy.cancel')}</Button>}
                {saved && <Badge variant='secondary'>{t('energy.saved')}</Badge>}
                {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'><Activity className='size-5' />{t('energy.history')}</CardTitle>
            <CardDescription>{average === null ? t('energy.noAverage') : t('energy.average', { score: average })}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {loading ? (
              <p role='status' className='text-sm text-muted-foreground'>{t('energy.loading')}</p>
            ) : error && logs.length === 0 ? (
              <p role='alert' className='text-sm text-destructive'>{error}</p>
            ) : logs.length ? (
              logs.map((log) => (
                <article key={log.id} className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'>
                  <div className='min-w-48 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Badge variant='secondary'>{t('energy.scoreValue', { score: log.score })}</Badge>
                      <span className='text-sm text-muted-foreground'>
                        {formatClockTime(new Date(log.timestamp), i18n.language)}
                      </span>
                    </div>
                    {log.note && <p className='mt-2 whitespace-pre-wrap text-sm'>{log.note}</p>}
                  </div>
                  <div className='flex gap-1'>
                    <Button size='icon' variant='ghost' aria-label={t('energy.edit')} onClick={() => edit(log)}><Pencil className='size-4' /></Button>
                    <Button size='icon' variant='ghost' aria-label={t('energy.delete')} onClick={() => void remove(log)}><Trash2 className='size-4' /></Button>
                  </div>
                </article>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>{t('energy.empty')}</p>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
