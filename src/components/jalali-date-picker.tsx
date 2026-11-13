import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  dateKeyOf,
  dateKeyToJalali,
  formatJalaliDateKey,
  jalaliMonthLength,
  jalaliToDate,
  jalaliToDateKey,
  toPersianDigits,
  type JalaliDate,
} from '@/lib/jalali'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface JalaliDatePickerProps {
  /** Gregorian day key (`yyyy-MM-dd`) stored by the app. */
  value: string
  onChange: (dateKey: string) => void
  ariaLabel?: string
  id?: string
  className?: string
  disabled?: boolean
  /** Shows a reset action that clears the stored date. */
  clearable?: boolean
}

const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

const ENGLISH_MONTHS = [
  'Farvardin',
  'Ordibehesht',
  'Khordad',
  'Tir',
  'Mordad',
  'Shahrivar',
  'Mehr',
  'Aban',
  'Azar',
  'Dey',
  'Bahman',
  'Esfand',
]

/** Saturday-first week, matching the Persian calendar layout. */
const PERSIAN_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
const ENGLISH_WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function jalaliOf(dateKey: string): JalaliDate | null {
  if (!dateKey) return null
  try {
    const parts = dateKeyToJalali(dateKey)
    return Number.isFinite(parts.jy) ? parts : null
  } catch {
    return null
  }
}

function todayJalali(): JalaliDate {
  return dateKeyToJalali(dateKeyOf(new Date()))
}

function addMonths(
  view: { jy: number; jm: number },
  delta: number
): { jy: number; jm: number } {
  const total = view.jy * 12 + (view.jm - 1) + delta
  return { jy: Math.floor(total / 12), jm: (total % 12) + 1 }
}

function displayDate(dateKey: string): string {
  if (!dateKey) return ''
  try {
    return formatJalaliDateKey(dateKey)
  } catch {
    return ''
  }
}

/**
 * Jalali (Solar Hijri) calendar picker.
 *
 * The calendar is the only input path: there is no text field, so a date can
 * only be chosen from real Jalali months. The component receives and emits the
 * Gregorian `yyyy-MM-dd` day key the app already stores, so switching the UI
 * language or reopening the picker never shifts the selected day.
 */
export function JalaliDatePicker({
  value,
  onChange,
  ariaLabel,
  id,
  className,
  disabled,
  clearable = false,
}: JalaliDatePickerProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const isPersian = language.startsWith('fa')
  const dir = isPersian ? 'rtl' : 'ltr'

  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const base = jalaliOf(value) ?? todayJalali()
    return { jy: base.jy, jm: base.jm }
  })

  const months = isPersian ? PERSIAN_MONTHS : ENGLISH_MONTHS
  const weekdays = isPersian ? PERSIAN_WEEKDAYS : ENGLISH_WEEKDAYS
  const monthName = months[view.jm - 1] ?? ''
  const today = todayJalali()
  const todayKey = dateKeyOf(new Date())
  const selected = jalaliOf(value)
  const display = displayDate(value)

  const firstWeekday = (jalaliToDate(view.jy, view.jm, 1).getUTCDay() + 1) % 7
  const monthLength = jalaliMonthLength(view.jy, view.jm)

  const yearStart = Math.min(today.jy - 100, selected?.jy ?? today.jy, view.jy)
  const yearEnd = Math.max(today.jy + 10, selected?.jy ?? today.jy, view.jy)
  const years: number[] = []
  for (let year = yearStart; year <= yearEnd; year += 1) years.push(year)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      const base = jalaliOf(value) ?? todayJalali()
      setView({ jy: base.jy, jm: base.jm })
    }
  }

  const pickDay = (day: number) => {
    onChange(jalaliToDateKey(view.jy, view.jm, day))
    setOpen(false)
  }

  const pickToday = () => {
    onChange(todayKey)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          dir={dir}
          data-empty={!value}
          className={cn(
            'w-full min-w-0 justify-between font-normal data-[empty=true]:text-muted-foreground',
            className
          )}
        >
          <span className='truncate'>{display || t('pickers.chooseDate')}</span>
          <CalendarDays className='size-4 shrink-0 opacity-60' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[19rem] max-w-[calc(100vw_-_1rem)] p-3'
      >
        <div className='mb-2 flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-8 shrink-0'
            aria-label={t('pickers.previousMonth')}
            onClick={() => setView(addMonths(view, -1))}
          >
            {dir === 'rtl' ? (
              <ChevronRight className='size-4' />
            ) : (
              <ChevronLeft className='size-4' />
            )}
          </Button>
          <div className='flex min-w-0 flex-1 items-center justify-center gap-1'>
            <select
              aria-label={t('pickers.month')}
              className='h-8 min-w-0 rounded-md border bg-background px-1 text-sm'
              value={view.jm}
              onChange={(event) =>
                setView({ ...view, jm: Number(event.target.value) })
              }
            >
              {months.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
            <select
              aria-label={t('pickers.year')}
              className='h-8 rounded-md border bg-background px-1 text-sm tabular-nums'
              value={view.jy}
              onChange={(event) =>
                setView({ ...view, jy: Number(event.target.value) })
              }
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {isPersian ? toPersianDigits(year) : year}
                </option>
              ))}
            </select>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-8 shrink-0'
            aria-label={t('pickers.nextMonth')}
            onClick={() => setView(addMonths(view, 1))}
          >
            {dir === 'rtl' ? (
              <ChevronLeft className='size-4' />
            ) : (
              <ChevronRight className='size-4' />
            )}
          </Button>
        </div>

        <div
          className='grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-muted-foreground'
          aria-hidden='true'
        >
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>

        <div className='grid grid-cols-7 gap-1'>
          {Array.from({ length: firstWeekday }, (_, index) => (
            <span key={`blank-${index}`} aria-hidden='true' />
          ))}
          {Array.from({ length: monthLength }, (_, index) => {
            const day = index + 1
            const dateKey = jalaliToDateKey(view.jy, view.jm, day)
            const isSelected = dateKey === value
            const isToday = dateKey === todayKey
            const dayLabel = isPersian ? toPersianDigits(day) : String(day)
            const fullLabel = `${dayLabel} ${monthName} ${
              isPersian ? toPersianDigits(view.jy) : view.jy
            }`
            return (
              <button
                key={dateKey}
                type='button'
                aria-label={fullLabel}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => pickDay(day)}
                className={cn(
                  'h-9 w-full rounded-md text-sm tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  isToday && !isSelected && 'border border-primary/50',
                  isSelected &&
                    'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                {dayLabel}
              </button>
            )
          })}
        </div>

        <div className='mt-2 flex items-center justify-between gap-2 border-t pt-2'>
          <Button type='button' variant='outline' size='sm' onClick={pickToday}>
            {t('pickers.today')}
          </Button>
          {clearable && value ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {t('pickers.clear')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
