import { describe, expect, it } from 'vitest'
import {
  dateKeyToJalali,
  formatJalaliDateKey,
  jalaliMonthLength,
  jalaliToDateKey,
  parseJalaliInput,
} from '@/lib/jalali'

describe('Jalali day-key conversion', () => {
  it('converts a Gregorian day key to Jalali and back', () => {
    expect(dateKeyToJalali('2026-11-12')).toEqual({ jy: 1405, jm: 8, jd: 21 })
    expect(jalaliToDateKey(1405, 8, 21)).toBe('2026-11-12')
    expect(formatJalaliDateKey('2026-11-12')).toBe('۱۴۰۵/۰۸/۲۱')
  })

  it('parses typed Jalali dates, including Persian digits', () => {
    expect(parseJalaliInput('1405/08/21')).toBe('2026-11-12')
    expect(parseJalaliInput('۱۴۰۵/۰۸/۲۱')).toBe('2026-11-12')
    expect(parseJalaliInput('1405-8-21')).toBe('2026-11-12')
    expect(parseJalaliInput('1405/12/30')).toBeNull()
  })

  it('knows the length of Esfand in leap and common years', () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30)
    expect(jalaliMonthLength(1405, 12)).toBe(29)
    expect(jalaliMonthLength(1405, 1)).toBe(31)
    expect(jalaliMonthLength(1405, 7)).toBe(30)
  })
})
