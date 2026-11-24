import { describe, expect, it } from 'vitest'
import {
  averageDefined,
  cumulativeSeries,
  deltaPercent,
  isValidRange,
  jalaliMonthRange,
  presetRange,
  previousRange,
  sharePercent,
  shortJalaliLabel,
  sleepMinutesBetween,
  sumValues,
  weekdayAverages,
  weekdayIndexOf,
} from '@/features/analytics/analytics-utils'

const TODAY = '2026-11-19' // 1405/08/28, a Thursday

describe('analytics ranges', () => {
  it('builds Jalali month bounds and the previous month', () => {
    const thisMonth = jalaliMonthRange(0, TODAY)
    expect(thisMonth.from).toBe('2026-10-23') // 1405/08/01
    expect(thisMonth.to).toBe('2026-11-21') // 1405/08/29
    const lastMonth = jalaliMonthRange(-1, TODAY)
    expect(lastMonth.to < thisMonth.from).toBe(true)
    expect(lastMonth.from < lastMonth.to).toBe(true)
  })

  it('resolves every preset inside its declared window', () => {
    expect(presetRange('day', TODAY)).toEqual({ from: TODAY, to: TODAY })

    const threeDays = presetRange('threeDays', TODAY)
    expect(threeDays).toEqual({ from: '2026-11-17', to: TODAY })

    const week = presetRange('week', TODAY)
    expect(week.from).toBe('2026-11-14') // Saturday
    expect(week.to).toBe('2026-11-20') // Friday
    expect(weekdayIndexOf(week.from)).toBe(0)

    const twoWeeks = presetRange('twoWeeks', TODAY)
    expect(twoWeeks.from).toBe('2026-11-07')
    expect(twoWeeks.to).toBe('2026-11-20')

    expect(presetRange('thisMonth', TODAY)).toEqual(jalaliMonthRange(0, TODAY))
    expect(presetRange('lastMonth', TODAY)).toEqual(jalaliMonthRange(-1, TODAY))

    const threeMonths = presetRange('threeMonths', TODAY)
    expect(threeMonths.to).toBe(TODAY)
    expect(threeMonths.from).toBe(jalaliMonthRange(-2, TODAY).from)
  })

  it('compares a range with the immediately previous equal-length range', () => {
    expect(previousRange('2026-11-14', '2026-11-20', 'week', TODAY)).toEqual({
      from: '2026-11-07',
      to: '2026-11-13',
    })
    expect(previousRange(TODAY, TODAY, 'day', TODAY)).toEqual({
      from: '2026-11-18',
      to: '2026-11-18',
    })
    // A Jalali month is compared with the exact previous Jalali month.
    expect(
      previousRange('2026-10-23', '2026-11-21', 'thisMonth', TODAY)
    ).toEqual(jalaliMonthRange(-2, TODAY))
  })

  it('validates custom ranges', () => {
    expect(isValidRange('2026-11-01', '2026-11-19')).toBe(true)
    expect(isValidRange('2026-11-19', '2026-11-01')).toBe(false)
    expect(isValidRange('', '2026-11-19')).toBe(false)
  })
})

describe('analytics aggregation helpers', () => {
  it('computes sleep across midnight without a day shift', () => {
    expect(sleepMinutesBetween('23:30', '06:15')).toBe(405)
    expect(sleepMinutesBetween('01:00', '08:00')).toBe(420)
    expect(sleepMinutesBetween('', '08:00')).toBeNull()
  })

  it('averages by weekday and only over days that exist', () => {
    // 2026-11-14 Saturday, 2026-11-15 Sunday, 2026-11-16 Monday.
    const days = ['2026-11-14', '2026-11-15', '2026-11-16']
    const values = { '2026-11-14': 3600, '2026-11-15': 1800, '2026-11-16': 900 }
    const averages = weekdayAverages(values, days)
    expect(averages[0]).toEqual({ weekday: 0, average: 3600, days: 1 }) // Saturday
    expect(averages[1]).toEqual({ weekday: 1, average: 1800, days: 1 }) // Sunday
    expect(averages[2]).toEqual({ weekday: 2, average: 900, days: 1 }) // Monday
    expect(averages[3]?.days).toBe(0)
  })

  it('averages two occurrences of the same weekday instead of dropping one', () => {
    // 2026-11-14 and 2026-11-21 are both Saturdays in the same range.
    const days = ['2026-11-14', '2026-11-21']
    const averages = weekdayAverages(
      { '2026-11-14': 3600, '2026-11-21': 7200 },
      days
    )
    expect(averages[0]).toEqual({ weekday: 0, average: 5400, days: 2 })
  })

  it('builds a cumulative series and totals', () => {
    const values = { a: 3600, b: 1800 }
    expect(cumulativeSeries(values, ['a', 'b', 'c'])).toEqual([
      3600, 5400, 5400,
    ])
    expect(sumValues(values, ['a', 'b', 'c'])).toBe(5400)
    expect(averageDefined({ a: 10, b: null, c: 20 }, ['a', 'b', 'c'])).toBe(15)
    expect(averageDefined({ a: null }, ['a'])).toBeNull()
  })

  it('guards shares and short Jalali labels', () => {
    expect(sharePercent(50, 200)).toBe(25)
    expect(sharePercent(10, 0)).toBe(0)
    expect(shortJalaliLabel('2026-11-19')).toBe('۰۸/۲۸')
  })

  it('computes comparison deltas without inventing a change from zero', () => {
    expect(deltaPercent(120, 100)).toBeCloseTo(20)
    expect(deltaPercent(80, 100)).toBeCloseTo(-20)
    expect(deltaPercent(100, 100)).toBe(0)
    expect(deltaPercent(25, 0)).toBeNull()
    expect(deltaPercent(0, 0)).toBeNull()
    expect(deltaPercent(5, -5)).toBeNull()
    expect(deltaPercent(-1, -2)).toBeCloseTo(50)
  })
})
