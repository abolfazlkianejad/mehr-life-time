import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toPersianDigits } from '@/lib/jalali'
import { isClockTime, localizeClockTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface TimePicker24Props {
  /** Current value as strict `HH:MM`; an empty string means "not set". */
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  id?: string
  className?: string
  disabled?: boolean
  /** Shows a reset action for optional fields. */
  clearable?: boolean
}

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)

const pad = (value: number) => String(value).padStart(2, '0')

function splitValue(value: string): { hour: number; minute: number } | null {
  if (!isClockTime(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  return { hour: hour ?? 0, minute: minute ?? 0 }
}

/**
 * 24-hour clock picker.
 *
 * Hours are limited to 00–23 and minutes to 00–59, and there is no text field,
 * so AM/PM or an out-of-range value can never be entered. The picker emits an
 * ASCII `HH:MM` string, which is exactly what the app already stores.
 */
export function TimePicker24({
  value,
  onChange,
  ariaLabel,
  id,
  className,
  disabled,
  clearable = false,
}: TimePicker24Props) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const isPersian = language.startsWith('fa')

  const [open, setOpen] = useState(false)
  const selectedHourRef = useRef<HTMLButtonElement>(null)
  const selectedMinuteRef = useRef<HTMLButtonElement>(null)

  const selected = splitValue(value)
  const display = isClockTime(value) ? localizeClockTime(value, language) : ''
  const padOption = (part: number) =>
    isPersian ? toPersianDigits(pad(part)) : pad(part)

  // Bring the active hour/minute into view each time the picker opens.
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      selectedHourRef.current?.scrollIntoView({ block: 'center' })
      selectedMinuteRef.current?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const pickHour = (hour: number) => {
    onChange(`${pad(hour)}:${pad(selected?.minute ?? 0)}`)
  }

  const pickMinute = (minute: number) => {
    onChange(`${pad(selected?.hour ?? 0)}:${pad(minute)}`)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          data-empty={!display}
          className={cn(
            'w-full justify-between font-normal data-[empty=true]:text-muted-foreground',
            className
          )}
        >
          <span className='font-mono tabular-nums' dir='ltr'>
            {display || t('pickers.chooseTime')}
          </span>
          <Clock className='size-4 shrink-0 opacity-60' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-52 p-3'>
        <p className='pb-2 text-sm font-medium'>{t('pickers.selectTime')}</p>
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <p className='pb-1 text-center text-xs font-medium text-muted-foreground'>
              {t('pickers.hour')}
            </p>
            <div
              role='listbox'
              aria-label={t('pickers.hour')}
              dir='ltr'
              className='h-52 overflow-y-auto rounded-md border p-1'
            >
              {HOURS.map((hour) => {
                const isSelected = selected?.hour === hour
                return (
                  <button
                    key={hour}
                    ref={isSelected ? selectedHourRef : undefined}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    aria-label={`${t('pickers.hour')} ${pad(hour)}`}
                    onClick={() => pickHour(hour)}
                    className={cn(
                      'flex h-8 w-full items-center justify-center rounded-sm text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    )}
                  >
                    {padOption(hour)}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className='pb-1 text-center text-xs font-medium text-muted-foreground'>
              {t('pickers.minute')}
            </p>
            <div
              role='listbox'
              aria-label={t('pickers.minute')}
              dir='ltr'
              className='h-52 overflow-y-auto rounded-md border p-1'
            >
              {MINUTES.map((minute) => {
                const isSelected = selected?.minute === minute
                return (
                  <button
                    key={minute}
                    ref={isSelected ? selectedMinuteRef : undefined}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    aria-label={`${t('pickers.minute')} ${pad(minute)}`}
                    onClick={() => pickMinute(minute)}
                    className={cn(
                      'flex h-8 w-full items-center justify-center rounded-sm text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    )}
                  >
                    {padOption(minute)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        {clearable && value ? (
          <div className='mt-2 border-t pt-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='w-full'
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {t('pickers.clear')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
