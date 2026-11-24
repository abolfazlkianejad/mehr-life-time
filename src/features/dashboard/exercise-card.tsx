/**
 * One scheduled workout rendered with the same visual weight as a task card.
 *
 * The card never writes on its own: the parent passes actions to the gym
 * service, and the once-per-second ticker only recalculates displayed seconds.
 */
import { useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  ExternalLink,
  Pause,
  Play,
  Timer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GYM_WEEKDAY_I18N_KEYS, type GymWeekday } from '@/lib/gym-weekdays'
import { formatJalaliDateKey } from '@/lib/jalali'
import { gymElapsedSeconds } from '@/services/gym'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatStudyDuration } from '@/features/learning/education-utils'
import type { ExerciseActivity } from './exercise-activities'

export type ExerciseAction = 'start' | 'pause' | 'finish'

interface ExerciseCardProps {
  activity: ExerciseActivity
  now: number
  busy: boolean
  startBlocked: boolean
  onAction: (activity: ExerciseActivity, action: ExerciseAction) => void
}

const STATUS_KEYS: Record<ExerciseActivity['status'], string> = {
  planned: 'dashboard.exercisePlanned',
  draft: 'dashboard.exerciseDraft',
  running: 'dashboard.exerciseRunning',
  paused: 'dashboard.exercisePaused',
  done: 'dashboard.exerciseDone',
}

function weekdayKey(weekday: GymWeekday): string {
  return `gym.days.${GYM_WEEKDAY_I18N_KEYS[weekday]}`
}

export function ExerciseCard({
  activity,
  now,
  busy,
  startBlocked,
  onAction,
}: ExerciseCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const running = activity.status === 'running'
  const done = activity.status === 'done'
  const hasSession = Boolean(activity.session)
  // Pure calculation from persisted fields plus the parent's single ticker.
  const liveSeconds = activity.session
    ? gymElapsedSeconds(activity.session, now)
    : 0

  return (
    <li className='rounded-lg border border-s-4 border-s-fuchsia-500 bg-fuchsia-50/40 transition-colors hover:bg-fuchsia-50/70 dark:bg-fuchsia-950/10'>
      <div className='flex flex-wrap items-center justify-between gap-3 p-3'>
        <div className='flex min-w-0 flex-1 flex-col items-start gap-1.5'>
          <span className='flex flex-wrap items-center gap-1.5'>
            <span className='font-medium'>{activity.title}</span>
            <Badge variant='outline' className='gap-1 border-fuchsia-300'>
              <Dumbbell className='size-3 text-fuchsia-600' />
              {t('dashboard.exerciseType')}
            </Badge>
            <Badge variant={done ? 'secondary' : 'outline'}>
              {t(STATUS_KEYS[activity.status])}
            </Badge>
            {running ? (
              <span className='inline-flex items-center gap-1 text-xs font-medium text-emerald-600'>
                <span className='size-2 animate-pulse rounded-full bg-emerald-500' />
                {t('dashboard.timerRunning')}
              </span>
            ) : null}
          </span>
          <span className='text-xs text-muted-foreground'>
            <CalendarDays className='me-1 inline size-3.5' />
            {formatJalaliDateKey(activity.dateKey)} ·{' '}
            {t(weekdayKey(activity.weekday))}
            {activity.plannedMinutes
              ? ` · ${t('dashboard.exercisePlannedTime')}: ${activity.plannedMinutes} ${t('dashboard.minutes')}`
              : ''}
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='secondary' className='font-mono tabular-nums'>
            <Timer className='me-1 size-3.5' />
            {t('dashboard.exerciseActualTime')}:{' '}
            {formatStudyDuration(liveSeconds)}
          </Badge>
          {!done ? (
            <>
              {running ? (
                <Button
                  size='icon'
                  variant='outline'
                  aria-label={t('dashboard.exercisePause')}
                  title={t('dashboard.exercisePause')}
                  disabled={busy}
                  onClick={() => onAction(activity, 'pause')}
                >
                  <Pause className='size-4' />
                </Button>
              ) : (
                <Button
                  size='icon'
                  variant='outline'
                  aria-label={
                    hasSession
                      ? t('dashboard.exerciseResume')
                      : t('dashboard.exerciseStart')
                  }
                  title={
                    hasSession
                      ? t('dashboard.exerciseResume')
                      : t('dashboard.exerciseStart')
                  }
                  disabled={busy || startBlocked}
                  onClick={() => onAction(activity, 'start')}
                >
                  <Play className='size-4' />
                </Button>
              )}
              {hasSession ? (
                <Button
                  size='icon'
                  aria-label={t('dashboard.exerciseFinish')}
                  title={t('dashboard.exerciseFinish')}
                  disabled={busy}
                  onClick={() => onAction(activity, 'finish')}
                >
                  <Check className='size-4' />
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            size='icon'
            variant='ghost'
            aria-label={t('dashboard.exerciseDetails')}
            title={t('dashboard.exerciseDetails')}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronUp className='size-4' />
            ) : (
              <ChevronDown className='size-4' />
            )}
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className='space-y-1.5 border-t px-3 py-2 text-sm'>
          {activity.exerciseNames.length ? (
            <ul className='flex flex-wrap gap-1.5'>
              {activity.exerciseNames.map((name) => (
                <li key={name}>
                  <Badge variant='outline'>{name}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground'>{t('gym.noExercises')}</p>
          )}
          {activity.session?.actualSeconds !== undefined ? (
            <p>
              {t('gym.actualDuration')}:{' '}
              <span className='font-mono tabular-nums'>
                {formatStudyDuration(activity.session.actualSeconds)}
              </span>
            </p>
          ) : null}
          <a
            href='/gym'
            className='inline-flex items-center gap-1 text-xs text-primary underline'
          >
            <ExternalLink className='size-3.5' />
            {t('dashboard.tasksOpenModule')}
          </a>
        </div>
      ) : null}
    </li>
  )
}
