/**
 * Jalali (Solar Hijri) calendar helpers.
 *
 * Internal storage stays Gregorian (`yyyy-MM-dd` day keys and ISO timestamps);
 * the conversion happens only in the presentation layer. Every conversion runs
 * on UTC midnights, so the calendar day never shifts with the browser timezone.
 */

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

const DAY_MS = 86_400_000

export interface JalaliDate {
  jy: number
  jm: number
  jd: number
}

const jalaliParts = new Intl.DateTimeFormat('en-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
})

const jalaliLong = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  dateStyle: 'long',
  timeZone: 'UTC',
})

/** Converts ASCII or Arabic-Indic digits to Persian digits. */
export function toPersianDigits(value: string | number): string {
  return String(value)
    .replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit)
    .replace(/[٠-٩]/g, (digit) => {
      const index = ARABIC_DIGITS.indexOf(digit)
      return index === -1 ? digit : (PERSIAN_DIGITS[index] ?? digit)
    })
}

/** Converts Persian or Arabic-Indic digits to ASCII digits. */
export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
}

/** Jalali components of a UTC instant. */
export function toJalali(date: Date): JalaliDate {
  const parts = jalaliParts.formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type)
    return part ? Number.parseInt(part.value.replace(/[^\d]/g, ''), 10) : Number.NaN
  }
  return { jy: read('year'), jm: read('month'), jd: read('day') }
}

const nowruzCache = new Map<number, number>()

/** UTC timestamp of 1 Farvardin (Nowruz) of the given Jalali year. */
function nowruz(jy: number): number {
  const cached = nowruzCache.get(jy)
  if (cached !== undefined) return cached
  // Nowruz falls on 20 or 21 March of the Gregorian year `jy + 621`.
  for (let offset = -3; offset <= 4; offset += 1) {
    const candidate = Date.UTC(jy + 621, 2, 20 + offset)
    const parts = toJalali(new Date(candidate))
    if (parts.jy === jy && parts.jm === 1 && parts.jd === 1) {
      nowruzCache.set(jy, candidate)
      return candidate
    }
  }
  throw new RangeError(`Unsupported Jalali year: ${jy}`)
}

const monthStartCache = new Map<string, number>()

/** UTC timestamp of the first day of a Jalali month. */
function monthStart(jy: number, jm: number): number {
  const key = `${jy}-${jm}`
  const cached = monthStartCache.get(key)
  if (cached !== undefined) return cached

  const start = nowruz(jy) + [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336][jm - 1]! * DAY_MS
  monthStartCache.set(key, start)
  return start
}

/** Number of days in a Jalali month (month 12 depends on the leap year). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  const day30 = monthStart(jy, 12) + 29 * DAY_MS
  const parts = toJalali(new Date(day30))
  return parts.jm === 12 && parts.jy === jy ? 30 : 29
}

/** Converts a Jalali date to a UTC `Date` at midnight. */
export function jalaliToDate(jy: number, jm: number, jd: number): Date {
  return new Date(monthStart(jy, jm) + (jd - 1) * DAY_MS)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `yyyy-MM-dd` day key for a Jalali date. */
export function jalaliToDateKey(jy: number, jm: number, jd: number): string {
  const date = jalaliToDate(jy, jm, jd)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Jalali components of a `yyyy-MM-dd` day key. */
export function dateKeyToJalali(dateKey: string): JalaliDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new RangeError(`Invalid date key: ${dateKey}`)
  const [, year, month, day] = match
  return toJalali(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))))
}

/** `1405/08/21` style label with Persian digits. */
export function formatJalaliDateKey(dateKey: string | undefined): string {
  if (!dateKey) return '—'
  try {
    const { jy, jm, jd } = dateKeyToJalali(dateKey)
    return toPersianDigits(`${jy}/${pad(jm)}/${pad(jd)}`)
  } catch {
    return '—'
  }
}

/** `۲۱ آبان ۱۴۰۵` style label. */
export function formatJalaliLong(dateKey: string | undefined): string {
  if (!dateKey) return '—'
  try {
    return jalaliLong.format(new Date(`${dateKey}T00:00:00Z`))
  } catch {
    return '—'
  }
}

/** Jalali label plus 24-hour time for an ISO timestamp. */
export function formatJalaliDateTime(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '—'
  return `${formatJalaliLong(dateKeyOf(date))} · ${formatTime24(date)}`
}

/** Local `yyyy-MM-dd` key of a date. */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 24-hour `HH:mm` clock label, independent of the browser locale. */
export function formatTime24(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 24-hour `HH:mm:ss` clock label. */
export function formatTime24Seconds(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Parses a user-typed Jalali date (`1405/08/21`, `۱۴۰۵-۸-۲۱`) into a day key.
 * Returns `null` when the text is not a real, existing Jalali date.
 */
export function parseJalaliInput(input: string): string | null {
  const normalized = toEnglishDigits(input).trim().replace(/[.\-\s]/g, '/')
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized)
  if (!match) return null
  const jy = Number(match[1])
  const jm = Number(match[2])
  const jd = Number(match[3])
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null
  if (jd > jalaliMonthLength(jy, jm)) return null
  const key = jalaliToDateKey(jy, jm, jd)
  const roundTrip = dateKeyToJalali(key)
  if (roundTrip.jy !== jy || roundTrip.jm !== jm || roundTrip.jd !== jd) return null
  return key
}

/** Jalali label of a day key, used by report tables and filters. */
export function formatJalaliDay(dateKey: string): string {
  return formatJalaliDateKey(dateKey)
}
