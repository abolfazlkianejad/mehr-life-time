import { describe, expect, it } from 'vitest'
import {
  dayKeysBetween,
  evaluateGoal,
  formatHoursMinutes,
  goalStatusColor,
  hoursToSeconds,
  periodProgress,
  secondsToHoursInput,
  weekKeysOf,
  weeklyDayShare,
} from '@/features/goals/goal-utils'

describe('goal progress', () => {
  it('marks a value below the target red with a negative difference', () => {
    const progress = evaluateGoal(4 * 3600, 2 * 3600)
    expect(progress.status).toBe('below')
    expect(progress.diff).toBe(-7200)
    expect(progress.percent).toBe(50)
    expect(goalStatusColor(progress.status)).toBe('destructive')
  })

  it('is green exactly at the target and above it, with a capped bar', () => {
    const atTarget = evaluateGoal(3600, 3600)
    expect(atTarget.status).toBe('met')
    expect(atTarget.percent).toBe(100)
    expect(atTarget.diff).toBe(0)

    const above = evaluateGoal(3600, 5400)
    expect(above.status).toBe('met')
    expect(above.percent).toBe(100)
    expect(above.rawPercent).toBe(150)
    expect(above.diff).toBe(1800)
    expect(goalStatusColor(above.status)).toBe('success')
  })

  it('reports an unset target instead of pretending success', () => {
    const progress = evaluateGoal(undefined, 1200)
    expect(progress.status).toBe('unset')
    expect(progress.target).toBe(0)
    expect(progress.percent).toBe(0)
    expect(goalStatusColor(progress.status)).toBe('muted')
  })
})

describe('goal date helpers', () => {
  it('starts weeks on Saturday and keeps exactly seven days', () => {
    // 2026-01-15 is a Thursday; the week starts on Saturday 2026-01-10.
    const week = weekKeysOf('2026-01-15')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-01-10')
    expect(week[6]).toBe('2026-01-16')
    expect(dayKeysBetween('2026-01-10', '2026-01-16')).toEqual(week)
  })

  it('handles a month and year boundary without shifting a day', () => {
    expect(weekKeysOf('2026-01-01')[0]).toBe('2025-12-27')
    expect(dayKeysBetween('2025-12-31', '2026-01-02')).toEqual([
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
    ])
  })

  it('rejects an inverted range', () => {
    expect(dayKeysBetween('2026-02-01', '2026-01-01')).toEqual([])
  })
})

describe('period progress', () => {
  const week = weekKeysOf('2026-01-15')
  const byDay = {
    '2026-01-10': 3600,
    '2026-01-12': 7200,
    '2026-01-16': 1800,
  }

  it('sums the same per-day map for daily and weekly goals', () => {
    const weekly = periodProgress('weekly', 28 * 3600, byDay, week)
    expect(weekly.progress.actual).toBe(12_600)
    expect(weekly.progress.target).toBe(100_800)
    expect(weekly.progress.status).toBe('below')
    expect(weekly.dayShares).toHaveLength(7)
    // The weekly target is split evenly over its seven days.
    expect(weekly.dayShares[0]?.share).toBe(14_400)
    expect(
      weekly.dayShares.reduce((total, entry) => total + entry.actual, 0)
    ).toBe(12_600)
  })

  it('uses the day itself for a daily goal', () => {
    const daily = periodProgress('daily', 4 * 3600, byDay, ['2026-01-12'])
    expect(daily.progress.actual).toBe(7200)
    expect(daily.progress.status).toBe('below')
    expect(daily.dayShares[0]).toEqual({
      dayKey: '2026-01-12',
      actual: 7200,
      share: 14_400,
    })
    expect(weeklyDayShare(7 * 3600)).toBe(3600)
    expect(weeklyDayShare(0)).toBe(0)
  })

  it('does not double count a day that appears twice in a caller list', () => {
    const twice = periodProgress('weekly', 7 * 3600, { '2026-01-10': 3600 }, [
      '2026-01-10',
      '2026-01-10',
    ])
    expect(twice.progress.actual).toBe(7200)
  })
})

describe('goal formatting helpers', () => {
  it('converts editable hours in both directions', () => {
    expect(hoursToSeconds(2.5)).toBe(9000)
    expect(hoursToSeconds('')).toBe(0)
    expect(secondsToHoursInput(9000)).toBe('2.5')
    expect(formatHoursMinutes(9000)).toBe('2:30')
    expect(formatHoursMinutes(0)).toBe('0:00')
    expect(formatHoursMinutes(-5)).toBe('0:00')
  })
})
