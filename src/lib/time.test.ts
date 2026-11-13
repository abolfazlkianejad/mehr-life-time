import { describe, expect, it } from 'vitest'
import {
  clockDateFromParts,
  clockTimeFromDate,
  formatClockTime,
  formatClockTimeSeconds,
  formatClockTimeValue,
  isClockTime,
  normalizeClockTime,
} from '@/lib/time'

const samples = [
  { hours: 0, minutes: 0, text: '00:00' },
  { hours: 9, minutes: 5, text: '09:05' },
  { hours: 12, minutes: 0, text: '12:00' },
  { hours: 13, minutes: 30, text: '13:30' },
  { hours: 23, minutes: 59, text: '23:59' },
]

const persian = ['۰۰:۰۰', '۰۹:۰۵', '۱۲:۰۰', '۱۳:۳۰', '۲۳:۵۹']

describe('24-hour clock text', () => {
  it.each(samples)(
    'keeps $text in 24-hour form',
    ({ hours, minutes, text }) => {
      expect(isClockTime(text)).toBe(true)
      expect(normalizeClockTime(text)).toBe(text)
      expect(clockTimeFromDate(new Date(2026, 0, 1, hours, minutes))).toBe(text)
    }
  )

  it.each(
    samples.map((sample, index) => ({ ...sample, persian: persian[index]! }))
  )(
    'renders $text for English and $persian for Persian',
    ({ hours, minutes, text, persian: persianText }) => {
      const date = new Date(2026, 0, 1, hours, minutes)
      expect(formatClockTime(date, 'en')).toBe(text)
      expect(formatClockTime(date, 'fa')).toBe(persianText)
      expect(formatClockTime(date, 'en')).not.toMatch(/AM|PM/i)
      expect(formatClockTime(date, 'fa')).not.toMatch(/AM|PM/i)
    }
  )

  it('never emits a 12-hour period marker', () => {
    for (let hours = 0; hours < 24; hours += 1) {
      const label = formatClockTime(new Date(2026, 0, 1, hours, 30), 'en-US')
      expect(label).toMatch(/^\d{2}:30$/)
      expect(label).not.toMatch(/AM|PM/i)
    }
  })

  it.each([
    ['9:5', '09:05'],
    ['9.05', '09:05'],
    ['0905', '09:05'],
    ['905', '09:05'],
    ['۰۰:۰۰', '00:00'],
    ['۰۹:۰۵', '09:05'],
    ['٠٩:٠٥', '09:05'],
    ['23:59', '23:59'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeClockTime(input)).toBe(expected)
  })

  it.each(['', '24:00', '23:60', '12', 'ab:cd', '-1:00', '99:99'])(
    'rejects out-of-range value %s',
    (input) => {
      expect(normalizeClockTime(input)).toBeNull()
      expect(isClockTime(input)).toBe(false)
    }
  )

  it('formats stored HH:MM values and seconds', () => {
    expect(formatClockTimeValue('09:05', 'fa')).toBe('۰۹:۰۵')
    expect(formatClockTimeValue('23:59', 'en')).toBe('23:59')
    expect(formatClockTimeValue(undefined, 'en')).toBe('—')
    expect(formatClockTimeSeconds(new Date(2026, 0, 1, 13, 30, 45), 'en')).toBe(
      '13:30:45'
    )
    expect(formatClockTimeSeconds(new Date(2026, 0, 1, 13, 30, 45), 'fa')).toBe(
      '۱۳:۳۰:۴۵'
    )
  })

  it('builds a local date from a day key and clock value', () => {
    const date = clockDateFromParts('2026-11-12', '13:30')
    expect(date).not.toBeNull()
    expect(date!.getFullYear()).toBe(2026)
    expect(date!.getMonth()).toBe(10)
    expect(date!.getDate()).toBe(12)
    expect(date!.getHours()).toBe(13)
    expect(date!.getMinutes()).toBe(30)
    expect(clockDateFromParts('2026-11-12', '24:00')).toBeNull()
    expect(clockDateFromParts('not-a-date', '09:05')).toBeNull()
  })
})
