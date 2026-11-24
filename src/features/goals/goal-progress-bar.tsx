/**
 * One goal progress bar for every surface that shows real tracked time.
 *
 * The thresholds come only from the stored weekly and daily targets:
 * below the weekly average keeps the previous appearance, the weekly average
 * up to the daily target is yellow, and anything above the daily target is
 * green. No fixed hour values are used.
 */
import { weeklyDayShare, type GoalProgress } from './goal-utils'

export type GoalThreshold = 'below' | 'yellow' | 'green' | 'unset'

export interface GoalThresholdInput {
  /** Actual tracked seconds for the displayed period. */
  actual: number
  /** Stored weekly time target in seconds. */
  weeklyTarget?: number
  /** Stored daily time target in seconds. */
  dailyTarget?: number
  /** Weekly bars compare a whole week, so both thresholds are scaled by 7. */
  period?: 'daily' | 'weekly'
}

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

/** Pure threshold calculation shared by Dashboard, Goals and Education. */
export function classifyGoalThreshold({
  actual,
  weeklyTarget,
  dailyTarget,
  period = 'daily',
}: GoalThresholdInput): GoalThreshold {
  const safeActual = Number.isFinite(actual) ? Math.max(0, actual) : 0
  const weekly = positive(weeklyTarget)
  const daily = positive(dailyTarget)
  if (!weekly && !daily) return 'unset'

  const scale = period === 'weekly' ? 7 : 1
  const baseline = weeklyDayShare(weekly) * scale
  const upper = daily * scale

  // A target above the daily target is green; reaching the daily target is
  // still yellow, and reaching the weekly average starts the yellow range.
  if (upper > 0 && safeActual > upper) return 'green'
  if (baseline > 0 && safeActual >= baseline) return 'yellow'
  if (!baseline && upper > 0 && safeActual >= upper) return 'yellow'
  return 'below'
}

export function goalThresholdBarClass(threshold: GoalThreshold): string {
  if (threshold === 'green') return 'bg-emerald-500'
  if (threshold === 'yellow') return 'bg-amber-500'
  if (threshold === 'below') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

export function goalThresholdTextClass(threshold: GoalThreshold): string {
  if (threshold === 'green') return 'text-emerald-600'
  if (threshold === 'yellow') return 'text-amber-600'
  if (threshold === 'below') return 'text-destructive'
  return 'text-muted-foreground'
}

export interface GoalProgressBarProps extends Omit<
  GoalThresholdInput,
  'actual'
> {
  progress: GoalProgress
  /** Optional override; defaults to `progress.actual`. */
  actual?: number
  /**
   * `thresholds` is the work-time bar requested for Dashboard/Education.
   * `status` preserves the original below/met colors for gym and extra goals.
   */
  mode?: 'thresholds' | 'status'
}

export function GoalProgressBar({
  progress,
  actual,
  weeklyTarget,
  dailyTarget,
  period,
  mode = 'thresholds',
}: GoalProgressBarProps) {
  const threshold =
    mode === 'status'
      ? progress.status === 'met'
        ? 'green'
        : progress.status === 'below'
          ? 'below'
          : 'unset'
      : classifyGoalThreshold({
          actual: actual ?? progress.actual ?? 0,
          weeklyTarget,
          dailyTarget,
          period,
        })
  return (
    <div
      className='h-2 w-full overflow-hidden rounded-full bg-muted'
      role='presentation'
      data-threshold={threshold}
    >
      <div
        className={`h-full rounded-full transition-all ${goalThresholdBarClass(threshold)}`}
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  )
}
