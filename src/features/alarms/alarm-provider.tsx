/**
 * App-wide alarm scheduler and overlay.
 *
 * One provider is mounted in the authenticated layout (so it also runs on every
 * page and in background tabs). It polls the real `alarms` store, atomically
 * claims due reminders, shows an in-app overlay + desktop notification, and
 * plays a chime. Reminders are evaluated locally by this app only.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BellRing, Clock, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTime } from '@/lib/time'
import {
  ALARMS_CHANGED_EVENT,
  cancelAlarm,
  claimAlarm,
  dismissAlarm,
  getAlarms,
  isAlarmDue,
  notifyAlarmsChanged,
  saveAlarm,
  snoozeAlarm,
  sweepMissedAlarms,
  type AlarmRecord,
} from '@/services/alarms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const POLL_MS = 15_000
const SNOOZE_MINUTES = 10
const CHIME_REPEAT_MS = 20_000

type PermissionState = NotificationPermission | 'unsupported'

interface AlarmContextValue {
  alarms: AlarmRecord[]
  upcoming: AlarmRecord[]
  active: AlarmRecord[]
  permission: PermissionState
  soundReady: boolean
  error: string
  requestPermission: () => Promise<void>
  playTestSound: () => void
  testAlarm: () => Promise<void>
  refresh: () => Promise<void>
  snooze: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
}

const AlarmContext = createContext<AlarmContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components -- the provider and its hook share one module
export function useAlarms(): AlarmContextValue {
  const value = useContext(AlarmContext)
  if (!value) throw new Error('useAlarms must be used inside <AlarmProvider>')
  return value
}

function currentPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window))
    return 'unsupported'
  return Notification.permission
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()

  const [alarms, setAlarms] = useState<AlarmRecord[]>([])
  const [active, setActive] = useState<AlarmRecord[]>([])
  const [permission, setPermission] =
    useState<PermissionState>(currentPermission)
  const [soundReady, setSoundReady] = useState(false)
  const [error, setError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())

  const loading = useRef(false)
  const shown = useRef(new Set<string>())
  const audio = useRef<AudioContext | null>(null)
  const permissionRef = useRef<PermissionState>(permission)

  useEffect(() => {
    permissionRef.current = permission
  }, [permission])

  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      if (!audio.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        if (!Ctor) return null
        audio.current = new Ctor()
      }
      if (audio.current.state === 'suspended') void audio.current.resume()
      setSoundReady(true)
      return audio.current
    } catch {
      return null
    }
  }, [])

  // Browsers only allow audio after a real user gesture inside the page.
  useEffect(() => {
    const unlock = () => {
      ensureAudio()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [ensureAudio])

  const playChime = useCallback(() => {
    const context = ensureAudio()
    if (!context) return
    const start = context.currentTime
    const notes = [880, 1175, 880]
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const at = start + index * 0.28
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.24, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.26)
    })
  }, [ensureAudio])

  const showDesktopNotification = useCallback(
    (alarm: AlarmRecord) => {
      if (permissionRef.current !== 'granted') return
      try {
        const notification = new Notification(t('alarms.firedTitle'), {
          body: t('alarms.firedBody', { title: alarm.title }),
          tag: `mehr-alarm-${alarm.id}-${alarm.at}`,
          requireInteraction: true,
          silent: false,
        })
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
      } catch {
        // The in-app overlay is still shown.
      }
    },
    [t]
  )

  const enqueue = useCallback(
    (alarm: AlarmRecord) => {
      const key = `${alarm.id}@${alarm.at}`
      if (shown.current.has(key)) return
      shown.current.add(key)
      setActive((current) =>
        current.some((entry) => entry.id === alarm.id)
          ? current
          : [...current, alarm]
      )
      playChime()
      showDesktopNotification(alarm)
    },
    [playChime, showDesktopNotification]
  )

  const refresh = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const now = Date.now()
      await sweepMissedAlarms(now)
      const rows = await getAlarms()
      setAlarms(rows)
      setNowMs(now)
      for (const row of rows) {
        if (!isAlarmDue(row, now)) continue
        const claimed = await claimAlarm(row.id, now)
        if (claimed) enqueue(claimed)
      }
      setError('')
    } catch {
      setError(t('alarms.error'))
    } finally {
      loading.current = false
    }
  }, [enqueue, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loader
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onChanged = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(ALARMS_CHANGED_EVENT, onChanged)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(ALARMS_CHANGED_EVENT, onChanged)
    }
  }, [refresh])

  // Keep chiming while an alarm is waiting to be stopped.
  useEffect(() => {
    if (!active.length) return
    const timer = window.setInterval(() => playChime(), CHIME_REPEAT_MS)
    return () => window.clearInterval(timer)
  }, [active.length, playChime])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    ensureAudio()
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      setPermission(currentPermission())
    }
  }, [ensureAudio])

  const snooze = useCallback(
    async (id: string) => {
      try {
        await snoozeAlarm(id, SNOOZE_MINUTES)
        setActive((current) => current.filter((alarm) => alarm.id !== id))
        notifyAlarmsChanged()
        await refresh()
      } catch {
        setError(t('alarms.error'))
      }
    },
    [refresh, t]
  )

  const dismiss = useCallback(
    async (id: string) => {
      try {
        await dismissAlarm(id)
        setActive((current) => current.filter((alarm) => alarm.id !== id))
        notifyAlarmsChanged()
        await refresh()
      } catch {
        setError(t('alarms.error'))
      }
    },
    [refresh, t]
  )

  const cancel = useCallback(
    async (id: string) => {
      try {
        await cancelAlarm(id)
        setActive((current) => current.filter((alarm) => alarm.id !== id))
        notifyAlarmsChanged()
        await refresh()
      } catch {
        setError(t('alarms.error'))
      }
    },
    [refresh, t]
  )

  const testAlarm = useCallback(async () => {
    try {
      if (permissionRef.current === 'default') await requestPermission()
      ensureAudio()
      await saveAlarm({
        id: `test-${Date.now()}`,
        title: t('alarms.testAlarm'),
        at: new Date(Date.now() + 5_000),
        source: 'manual',
      })
      notifyAlarmsChanged()
      await refresh()
      window.setTimeout(() => void refresh(), 6_000)
    } catch {
      setError(t('alarms.error'))
    }
  }, [ensureAudio, refresh, requestPermission, t])

  const upcoming = useMemo(
    () =>
      alarms.filter(
        (alarm) => alarm.status === 'scheduled' && Date.parse(alarm.at) >= nowMs
      ),
    [alarms, nowMs]
  )

  const value = useMemo<AlarmContextValue>(
    () => ({
      alarms,
      upcoming,
      active,
      permission,
      soundReady,
      error,
      requestPermission,
      playTestSound: playChime,
      testAlarm,
      refresh,
      snooze,
      dismiss,
      cancel,
    }),
    [
      alarms,
      upcoming,
      active,
      permission,
      soundReady,
      error,
      requestPermission,
      playChime,
      testAlarm,
      refresh,
      snooze,
      dismiss,
      cancel,
    ]
  )

  return (
    <AlarmContext.Provider value={value}>
      {children}
      <div
        className='pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-3 px-4 sm:items-end sm:px-6'
        aria-live='assertive'
      >
        {active.map((alarm) => (
          <div
            key={`${alarm.id}-${alarm.at}`}
            role='alertdialog'
            aria-label={t('alarms.firedTitle')}
            className='pointer-events-auto w-full max-w-md rounded-xl border bg-background p-4 shadow-2xl ring-1 ring-primary/20'
          >
            <div className='flex items-start gap-3'>
              <span className='rounded-full bg-primary/10 p-2 text-primary'>
                <BellRing className='size-5' />
              </span>
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-semibold'>
                  {t('alarms.firedTitle')}
                </p>
                <p className='truncate text-base font-medium'>{alarm.title}</p>
                <p className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <Clock className='size-3.5' />
                  <span className='tabular-nums'>
                    {formatJalaliDateKey(toDateKey(new Date(alarm.at)))} ·{' '}
                    {formatClockTime(new Date(alarm.at), i18n.language)}
                  </span>
                  {alarm.snoozeCount > 0 ? (
                    <Badge variant='outline'>
                      {t('alarms.snooze')} ×{alarm.snoozeCount}
                    </Badge>
                  ) : null}
                </p>
              </div>
            </div>
            <div className='mt-3 flex flex-wrap justify-end gap-2'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void snooze(alarm.id)}
              >
                {t('alarms.snooze')}
              </Button>
              <Button size='sm' onClick={() => void dismiss(alarm.id)}>
                <Square className='me-2 size-3.5' />
                {t('alarms.stop')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </AlarmContext.Provider>
  )
}
