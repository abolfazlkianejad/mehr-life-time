import { useEffect } from 'react'
import {
  BellRing,
  BellOff,
  CheckCircle2,
  Clock,
  Headphones,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import { formatClockTime } from '@/lib/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAlarms } from '@/features/alarms/alarm-provider'

export function AlarmSettings() {
  const { t, i18n } = useTranslation()
  const {
    upcoming,
    permission,
    soundReady,
    error,
    requestPermission,
    playTestSound,
    testAlarm,
    refresh,
    cancel,
  } = useAlarms()

  useEffect(() => {
    void refresh()
  }, [refresh])

  const permissionLabel = t(`alarms.permission.${permission}`)
  const permissionGranted = permission === 'granted'

  return (
    <div className='space-y-4'>
      {error ? (
        <p
          role='alert'
          className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
        >
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            {permissionGranted ? (
              <CheckCircle2 className='size-5 text-emerald-500' />
            ) : (
              <BellOff className='size-5 text-amber-500' />
            )}
            {t('alarms.enableNotifications')}
          </CardTitle>
          <CardDescription>{t('alarms.duplicateGuard')}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-3'>
          <Badge variant={permissionGranted ? 'secondary' : 'outline'}>
            {permissionLabel}
          </Badge>
          {permission === 'default' ? (
            <Button size='sm' onClick={() => void requestPermission()}>
              {t('alarms.enableNotifications')}
            </Button>
          ) : null}
          {permission === 'denied' ? (
            <p className='text-sm text-muted-foreground'>
              {t('alarms.permissionDenied')}
            </p>
          ) : null}
          {permission === 'unsupported' ? (
            <p className='text-sm text-muted-foreground'>
              {t('alarms.permission.unsupported')}
            </p>
          ) : null}
          <Button size='sm' variant='outline' onClick={() => void testAlarm()}>
            <BellRing className='me-2 size-4' />
            {t('alarms.testAlarm')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Headphones className='size-5 text-indigo-500' />
            {t('alarms.sound')}
          </CardTitle>
          <CardDescription>{t('alarms.soundHint')}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-3'>
          <Badge variant={soundReady ? 'secondary' : 'outline'}>
            {t(soundReady ? 'alarms.soundReady' : 'alarms.soundLocked')}
          </Badge>
          <Button size='sm' variant='outline' onClick={playTestSound}>
            {t('alarms.testSound')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Clock className='size-5 text-amber-500' />
            {t('alarms.upcoming')}
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          {upcoming.length ? (
            upcoming.map((alarm) => (
              <div
                key={alarm.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm'
              >
                <div>
                  <p className='font-medium'>{alarm.title}</p>
                  <p className='text-xs text-muted-foreground tabular-nums'>
                    {formatJalaliDateKey(toDateKey(new Date(alarm.at)))} ·{' '}
                    {formatClockTime(new Date(alarm.at), i18n.language)}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge variant='outline'>
                    {t('alarms.status.scheduled')}
                  </Badge>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => void cancel(alarm.id)}
                    aria-label={`${t('alarms.cancel')} ${alarm.title}`}
                  >
                    <XCircle className='me-2 size-4' />
                    {t('alarms.cancel')}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('alarms.noUpcoming')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
