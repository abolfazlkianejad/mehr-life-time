import type { MealLog } from '@/services/db'
import type { CardioLog } from '@/services/nutrition'

/**
 * Nutrition calculations.
 *
 * All deterministic numbers are computed here with plain formulas; the AI is
 * only used to *suggest* a value, which the user has to approve before it is
 * stored. Calories are never counted twice: intake comes from the confirmed
 * meals of the day, burned calories come from the cardio sessions of the same
 * day.
 */

export interface NutritionSummary {
  /** Calories from confirmed meals. */
  intake: number
  /** Calories burned by registered activities. */
  burned: number
  /** Intake minus burned calories. */
  net: number
  protein: number
  carbs: number
  fat: number
  /** Number of meals whose calorie value is still an unapproved estimate. */
  pendingEstimates: number
  /** `true` when at least one burned value is a formula estimate. */
  hasEstimatedBurn: boolean
}

/** A meal counts as confirmed unless the user explicitly marked it as an estimate. */
export function isConfirmedMeal(
  meal: Pick<MealLog, 'caloriesConfirmed'>
): boolean {
  return meal.caloriesConfirmed !== false
}

/**
 * Intake, burn and net calories for one day.
 *
 * Unconfirmed meal estimates are excluded from the intake total and reported
 * separately, so a pending AI suggestion never changes the daily balance.
 */
export function summarizeNutrition(
  meals: MealLog[],
  cardio: CardioLog[]
): NutritionSummary {
  const confirmed = meals.filter(isConfirmedMeal)
  const intake = confirmed.reduce((sum, meal) => sum + (meal.calories ?? 0), 0)
  const burned = cardio.reduce(
    (sum, session) => sum + (session.calories ?? 0),
    0
  )
  const protein = confirmed.reduce((sum, meal) => sum + (meal.protein ?? 0), 0)
  const carbs = confirmed.reduce((sum, meal) => sum + (meal.carbs ?? 0), 0)
  const fat = confirmed.reduce((sum, meal) => sum + (meal.fat ?? 0), 0)
  return {
    intake,
    burned,
    net: intake - burned,
    protein,
    carbs,
    fat,
    pendingEstimates: meals.length - confirmed.length,
    hasEstimatedBurn: cardio.some((session) => session.caloriesEstimated),
  }
}

/** MET values used by the calorie estimate. Higher intensity means higher MET. */
const MET_TABLE: Array<{ keys: string[]; met: number; label: string }> = [
  { keys: ['پیاده', 'walking', 'walk'], met: 3.5, label: 'پیاده‌روی' },
  { keys: ['دویدن', 'running', 'run'], met: 9, label: 'دویدن' },
  { keys: ['دوچرخه', 'cycling', 'bike'], met: 7.5, label: 'دوچرخه' },
  { keys: ['شنا', 'swim'], met: 8, label: 'شنا' },
  { keys: ['طناب', 'rope'], met: 11, label: 'طناب زدن' },
  { keys: ['هاییت', 'hiit'], met: 8.5, label: 'های‌ایتی' },
  {
    keys: ['وزنه', 'strength', 'بدنسازی', 'powerlifting'],
    met: 5,
    label: 'تمرین وزنه',
  },
  { keys: ['فوتبال', 'football', 'soccer'], met: 7, label: 'فوتبال' },
  { keys: ['بسکتبال', 'basketball'], met: 6.5, label: 'بسکتبال' },
  { keys: ['یوگا', 'yoga'], met: 3, label: 'یوگا' },
  { keys: ['elliptical', 'الپتیکال'], met: 5, label: 'الپتیکال' },
  { keys: ['والیبال', 'volleyball'], met: 4, label: 'والیبال' },
  { keys: ['شطرنج', 'chess'], met: 1.5, label: 'شطرنج' },
]

/** Normalises Persian and Arabic digits to ASCII and lowercases the text. */
export function normalizeText(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .trim()
    .toLowerCase()
}

/** MET value of an activity; falls back to a moderate value of 4. */
export function metValueOf(activity: string): number {
  const text = normalizeText(activity)
  const match = MET_TABLE.find((entry) =>
    entry.keys.some((key) => text.includes(normalizeText(key)))
  )
  return match?.met ?? 4
}

/**
 * Calories burned by an activity.
 *
 * Uses the standard MET formula: `kcal = MET × 3.5 × weightKg / 200 × minutes`.
 * The result is an estimate and is always labelled as such in the UI.
 */
export function estimateBurnedCalories(
  activity: string,
  minutes: number,
  weightKg: number
): number {
  const safeWeight = weightKg > 0 ? weightKg : 70
  const met = metValueOf(activity)
  return Math.round(((met * 3.5 * safeWeight) / 200) * minutes)
}

/** A food with a typical Iranian portion, used by the local fallback estimate. */
interface FoodEntry {
  keys: string[]
  label: string
  /** Calories for a typical portion. */
  calories: number
  protein: number
  carbs: number
  fat: number
  /** Portion multiplier for one described serving. */
  serving: number
}

const FOOD_TABLE: FoodEntry[] = [
  {
    keys: ['نان', 'bread'],
    label: 'نان',
    calories: 80,
    protein: 3,
    carbs: 15,
    fat: 1,
    serving: 1,
  },
  {
    keys: ['برنج', 'rice'],
    label: 'برنج',
    calories: 260,
    protein: 5,
    carbs: 55,
    fat: 3,
    serving: 1,
  },
  {
    keys: ['تخم مرغ', 'تخم‌مرغ', 'egg'],
    label: 'تخم‌مرغ',
    calories: 75,
    protein: 6,
    carbs: 0,
    fat: 5,
    serving: 1,
  },
  {
    keys: ['مرغ', 'chicken'],
    label: 'مرغ',
    calories: 250,
    protein: 46,
    carbs: 0,
    fat: 5,
    serving: 1,
  },
  {
    keys: ['گوشت', 'beef', 'steak'],
    label: 'گوشت',
    calories: 375,
    protein: 40,
    carbs: 0,
    fat: 24,
    serving: 1,
  },
  {
    keys: ['ماهی', 'fish'],
    label: 'ماهی',
    calories: 220,
    protein: 40,
    carbs: 0,
    fat: 6,
    serving: 1,
  },
  {
    keys: ['ماست', 'yogurt'],
    label: 'ماست',
    calories: 100,
    protein: 8,
    carbs: 12,
    fat: 3,
    serving: 1,
  },
  {
    keys: ['شیر', 'milk'],
    label: 'شیر',
    calories: 150,
    protein: 8,
    carbs: 12,
    fat: 8,
    serving: 1,
  },
  {
    keys: ['پنیر', 'cheese'],
    label: 'پنیر',
    calories: 85,
    protein: 6,
    carbs: 2,
    fat: 6,
    serving: 1,
  },
  {
    keys: ['سیب', 'apple'],
    label: 'سیب',
    calories: 80,
    protein: 0,
    carbs: 21,
    fat: 0,
    serving: 1,
  },
  {
    keys: ['موز', 'banana'],
    label: 'موز',
    calories: 105,
    protein: 1,
    carbs: 27,
    fat: 0,
    serving: 1,
  },
  {
    keys: ['سالاد', 'salad'],
    label: 'سالاد',
    calories: 40,
    protein: 1,
    carbs: 7,
    fat: 1,
    serving: 1,
  },
  {
    keys: ['ماکارونی', 'pasta'],
    label: 'ماکارونی',
    calories: 320,
    protein: 11,
    carbs: 62,
    fat: 4,
    serving: 1,
  },
  {
    keys: ['پیتزا', 'pizza'],
    label: 'پیتزا',
    calories: 400,
    protein: 16,
    carbs: 44,
    fat: 16,
    serving: 1,
  },
  {
    keys: ['برگر', 'burger'],
    label: 'برگر',
    calories: 500,
    protein: 25,
    carbs: 45,
    fat: 26,
    serving: 1,
  },
  {
    keys: ['خرما', 'khorma'],
    label: 'خورش',
    calories: 320,
    protein: 18,
    carbs: 32,
    fat: 13,
    serving: 1,
  },
  {
    keys: ['عدس', 'لوبیا', 'حبوبات', 'lentil'],
    label: 'حبوبات',
    calories: 230,
    protein: 13,
    carbs: 38,
    fat: 1,
    serving: 1,
  },
  {
    keys: ['چای', 'tea', 'قهوه', 'coffee'],
    label: 'نوشیدنی',
    calories: 5,
    protein: 0,
    carbs: 1,
    fat: 0,
    serving: 1,
  },
  {
    keys: ['بیسکویت', 'biscuit', 'cookie', 'کیک', 'cake', 'شکلات', 'chocolate'],
    label: 'شیرینی',
    calories: 180,
    protein: 2,
    carbs: 26,
    fat: 7,
    serving: 1,
  },
  {
    keys: ['آب', 'water'],
    label: 'آب',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    serving: 1,
  },
]

/** Parses a quantity description into a multiplier (for example "۲ کف دست" → 2). */
export function parseQuantityFactor(quantity: string | undefined): number {
  if (!quantity) return 1
  const match = /(\d+(?:\.\d+)?)/.exec(normalizeText(quantity))
  if (!match) return 1
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(value, 10)
}

export interface MealEstimate {
  calories: number
  protein: number
  carbs: number
  fat: number
  /** `ai` when the endpoint produced the numbers, `local` for the offline table. */
  source: 'ai' | 'local'
  /** Name of the food the estimate is based on (local table only). */
  matchedFood?: string
}

/**
 * Offline fallback for the calorie estimate.
 *
 * It is intentionally simple and transparent: a small table of typical Iranian
 * portions. The UI labels the result as a local estimate.
 */
export function estimateMealLocally(
  description: string,
  quantity?: string
): MealEstimate {
  const text = normalizeText(description)
  const factor = parseQuantityFactor(quantity)
  const match = FOOD_TABLE.find((entry) =>
    entry.keys.some((key) => text.includes(normalizeText(key)))
  )
  if (!match) {
    return {
      calories: Math.round(200 * factor),
      protein: Math.round(8 * factor),
      carbs: Math.round(28 * factor),
      fat: Math.round(7 * factor),
      source: 'local',
    }
  }
  return {
    calories: Math.round(match.calories * factor),
    protein: Math.round(match.protein * factor),
    carbs: Math.round(match.carbs * factor),
    fat: Math.round(match.fat * factor),
    source: 'local',
    matchedFood: match.label,
  }
}

/** Prompt for the AI calorie estimate; the answer must be JSON only. */
export function buildMealEstimatePrompt(
  description: string,
  quantity?: string
): string {
  return [
    'Estimate the nutrition of one meal entry.',
    `Food: ${description}`,
    quantity ? `Portion: ${quantity}` : 'Portion: one normal serving',
    'Answer with JSON only, using this exact shape:',
    '{"calories":number,"protein":number,"carbs":number,"fat":number,"food":"string"}',
    'Values are for the described portion in kcal and grams. Do not add any text.',
  ].join('\n')
}
