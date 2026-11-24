import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import i18n from '@/i18n/config'
import {
  classifyGoalThreshold,
  GoalProgressBar,
  goalThresholdBarClass,
  goalThresholdTextClass,
} from './goal-progress-bar'
import { evaluateGoal } from './goal-utils'

const HOUR = 60 * 60
const WEEKLY = 35 * HOUR
const DAILY = 6 * HOUR

describe('goal thresholds', () => {
  it('derives the daily baseline from the weekly goal, never a fixed value', () => {
    expect(
      classifyGoalThreshold({
        actual: 4 * HOUR,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('below')
    expect(
      classifyGoalThreshold({
        actual: 5 * HOUR,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('yellow')
    expect(
      classifyGoalThreshold({
        actual: 6 * HOUR,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('yellow')
    expect(
      classifyGoalThreshold({
        actual: 6 * HOUR + 1,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('green')

    // The same thresholds follow a different configured goal.
    expect(
      classifyGoalThreshold({
        actual: 10 * HOUR,
        weeklyTarget: 70 * HOUR,
        dailyTarget: 12 * HOUR,
      })
    ).toBe('yellow')
    expect(
      classifyGoalThreshold({
        actual: 12 * HOUR + 1,
        weeklyTarget: 70 * HOUR,
        dailyTarget: 12 * HOUR,
      })
    ).toBe('green')
  })

  it('scales both weekly thresholds by seven for a weekly bar', () => {
    expect(
      classifyGoalThreshold({
        actual: WEEKLY - 1,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
        period: 'weekly',
      })
    ).toBe('below')
    expect(
      classifyGoalThreshold({
        actual: WEEKLY,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
        period: 'weekly',
      })
    ).toBe('yellow')
    expect(
      classifyGoalThreshold({
        actual: 7 * DAILY,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
        period: 'weekly',
      })
    ).toBe('yellow')
    expect(
      classifyGoalThreshold({
        actual: 7 * DAILY + 1,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
        period: 'weekly',
      })
    ).toBe('green')
  })

  it('handles missing, zero, invalid and negative values safely', () => {
    expect(classifyGoalThreshold({ actual: Number.NaN })).toBe('unset')
    expect(
      classifyGoalThreshold({
        actual: 10 * HOUR,
        weeklyTarget: 0,
        dailyTarget: Number.NaN,
      })
    ).toBe('unset')
    expect(
      classifyGoalThreshold({
        actual: Number.POSITIVE_INFINITY,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('below')
    expect(
      classifyGoalThreshold({
        actual: -100,
        weeklyTarget: WEEKLY,
        dailyTarget: DAILY,
      })
    ).toBe('below')
    expect(
      classifyGoalThreshold({
        actual: WEEKLY,
        weeklyTarget: Number.NaN,
        dailyTarget: DAILY,
      })
    ).toBe('green')
  })

  it('uses one color mapping for the bar and percentage label', () => {
    expect(goalThresholdBarClass('below')).toBe('bg-destructive')
    expect(goalThresholdBarClass('yellow')).toBe('bg-amber-500')
    expect(goalThresholdBarClass('green')).toBe('bg-emerald-500')
    expect(goalThresholdTextClass('yellow')).toBe('text-amber-600')
    expect(goalThresholdTextClass('green')).toBe('text-emerald-600')
  })
})

describe('GoalProgressBar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it.each([
    [4 * HOUR, 'below'],
    [5 * HOUR, 'yellow'],
    [6 * HOUR + 1, 'green'],
  ] as const)(
    'renders %s seconds with the %s threshold',
    async (actual, expected) => {
      const screen = await render(
        <GoalProgressBar
          progress={evaluateGoal(DAILY, actual)}
          weeklyTarget={WEEKLY}
          dailyTarget={DAILY}
        />
      )
      const track = screen.container.querySelector('[data-threshold]')
      expect(track?.getAttribute('data-threshold')).toBe(expected)
      const fill = track?.firstElementChild as HTMLElement | null
      expect(parseFloat(fill?.style.width ?? '')).toBeCloseTo(
        Math.min(100, (actual / DAILY) * 100),
        3
      )
    }
  )
})
