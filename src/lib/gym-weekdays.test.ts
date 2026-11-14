import { describe, expect, it } from 'vitest'
import {
  GYM_WEEKDAYS,
  isGymWeekday,
  weekdayOfDateKey,
} from '@/lib/gym-weekdays'

describe('gym weekdays', () => {
  it('exposes all seven weekdays Saturday-first', () => {
    expect(GYM_WEEKDAYS).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('maps Gregorian dates to Saturday-first weekdays', () => {
    // 2026-11-14 is a Saturday; the following days continue the week.
    expect(weekdayOfDateKey('2026-11-14')).toBe(0)
    expect(weekdayOfDateKey('2026-11-15')).toBe(1)
    expect(weekdayOfDateKey('2026-11-16')).toBe(2)
    expect(weekdayOfDateKey('2026-11-17')).toBe(3)
    expect(weekdayOfDateKey('2026-11-18')).toBe(4)
    expect(weekdayOfDateKey('2026-11-19')).toBe(5)
    expect(weekdayOfDateKey('2026-11-20')).toBe(6)
  })

  it('rejects malformed or impossible date keys', () => {
    expect(() => weekdayOfDateKey('2026-13-01')).toThrow(RangeError)
    expect(() => weekdayOfDateKey('14-11-2026')).toThrow(RangeError)
    expect(() => weekdayOfDateKey('')).toThrow(RangeError)
    expect(() => weekdayOfDateKey('not-a-date')).toThrow(RangeError)
  })

  it('accepts only whole numbers between 0 and 6 as weekdays', () => {
    for (const weekday of GYM_WEEKDAYS) {
      expect(isGymWeekday(weekday)).toBe(true)
    }
    expect(isGymWeekday(7)).toBe(false)
    expect(isGymWeekday(-1)).toBe(false)
    expect(isGymWeekday(1.5)).toBe(false)
    expect(isGymWeekday('1')).toBe(false)
    expect(isGymWeekday(null)).toBe(false)
    expect(isGymWeekday(undefined)).toBe(false)
  })
})
