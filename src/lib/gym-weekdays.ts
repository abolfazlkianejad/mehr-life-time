/**
 * Saturday-first weekday model for the gym module.
 *
 * Persian calendars start the week on Saturday, so weekdays are stored as
 * 0 (Saturday) through 6 (Friday). The conversion from a Gregorian day key
 * uses UTC midnights (like the Jalali helpers) so the weekday never shifts
 * with the browser timezone.
 */

export type GymWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const GYM_WEEKDAYS: readonly GymWeekday[] = [0, 1, 2, 3, 4, 5, 6]

/** i18n keys of `gym.days.*`, indexed by weekday. */
export const GYM_WEEKDAY_I18N_KEYS = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const

export function isGymWeekday(value: unknown): value is GymWeekday {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  )
}

/** Saturday-first weekday (0..6) of a `yyyy-MM-dd` day key. */
export function weekdayOfDateKey(dateKey: string): GymWeekday {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`)
  }
  const parsed = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date key: ${dateKey}`)
  }
  // JS getUTCDay(): 0 = Sunday. Saturday becomes 0, Sunday 1, ... Friday 6.
  return ((parsed.getUTCDay() + 1) % 7) as GymWeekday
}
