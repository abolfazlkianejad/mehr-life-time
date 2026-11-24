/**
 * Education view of the shared goal thresholds.
 *
 * It receives only study seconds from the education module, so work time can
 * never be counted here. The bar component is the same one used by Dashboard
 * and Goals; only the source of `actual` differs.
 */
import { TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  classifyGoalThreshold,
  GoalProgressBar,
  goalThresholdTextClass,
} from '@/features/goals/goal-progress-bar'
import {
  evaluateGoal,
  formatHoursMinutes,
  type GoalProgress,
} from '@/features/goals/goal-utils'

interface StudyGoalProgressProps {
  /** Study-only seconds for the current local day. */
  todaySeconds: number
  /** Study-only seconds for the current Saturday-first week. */
  weekSeconds: number
  dailyTarget?: number
  weeklyTarget?: number
}

function ProgressRow({
  label,
  progress,
  dailyTarget,
  weeklyTarget,
  period,
}: {
  label: string
  progress: GoalProgress
  dailyTarget?: number
  weeklyTarget?: number
  period: 'daily' | 'weekly'
}) {
  const { t } = useTranslation()
  const threshold = classifyGoalThreshold({
    actual: progress.actual,
    dailyTarget,
    weeklyTarget,
    period,
  })
  return (
    <div className='space-y-1.5 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
        <span className='font-medium'>{label}</span>
        <span
          className={`font-medium tabular-nums ${goalThresholdTextClass(threshold)}`}
        >
          {t('learning.dashboard.progressActual')}:{' '}
          {formatHoursMinutes(progress.actual)}
        </span>
      </div>
      <GoalProgressBar
        progress={progress}
        weeklyTarget={weeklyTarget}
        dailyTarget={dailyTarget}
        period={period}
      />
      <div className='flex flex-wrap justify-between gap-2 text-xs text-muted-foreground'>
        <span>
          {t('learning.dashboard.progressTarget')}:{' '}
          {formatHoursMinutes(progress.target)}
        </span>
        <span className='tabular-nums'>{Math.round(progress.rawPercent)}%</span>
      </div>
    </div>
  )
}

export function StudyGoalProgress({
  todaySeconds,
  weekSeconds,
  dailyTarget,
  weeklyTarget,
}: StudyGoalProgressProps) {
  const { t } = useTranslation()
  const daily = evaluateGoal(dailyTarget, todaySeconds)
  const weekly = evaluateGoal(weeklyTarget, weekSeconds)

  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <TrendingUp className='size-4 text-indigo-500' />
          {t('learning.dashboard.progressTitle')}
        </CardTitle>
        <CardDescription>
          {t('learning.dashboard.progressHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {daily.status === 'unset' && weekly.status === 'unset' ? (
          <p className='text-sm text-muted-foreground'>
            {t('learning.dashboard.progressNoGoal')}
          </p>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2'>
            <ProgressRow
              label={t('learning.dashboard.progressDaily')}
              progress={daily}
              dailyTarget={dailyTarget}
              weeklyTarget={weeklyTarget}
              period='daily'
            />
            <ProgressRow
              label={t('learning.dashboard.progressWeekly')}
              progress={weekly}
              dailyTarget={dailyTarget}
              weeklyTarget={weeklyTarget}
              period='weekly'
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
