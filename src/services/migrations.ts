import { getAllRecords, putRecords } from '@/services/idb'
import {
  STORE_DASHBOARD_DAYS,
  STORE_DINNER_LOGS,
  STORE_MEAL_LOGS,
  STORE_META,
} from '@/services/stores'

interface LegacyDinnerRow {
  dateKey: string
  description: string
  calories: number
  caloriesConfirmed?: boolean
  updatedAt: string
}

interface LegacyDayRow {
  dateKey: string
  breakfast?: string
  breakfastCalories?: number
  breakfastCaloriesIsConfirmed?: boolean
  lunchDescription?: string
  lunchCalories?: number
  lunchCaloriesIsConfirmed?: boolean
}

interface MetaRow {
  key: string
  value: string
}

export const MEAL_MIGRATION_FLAG = 'mealsMigratedToMealLogs'

/**
 * Moves the meal information that older versions stored in the dashboard day
 * record and in the dedicated dinner store into the unified `mealLogs` store.
 *
 * The migration is additive and idempotent: every copied row gets a
 * deterministic id, so running it again updates the same record instead of
 * creating duplicates, and the original rows are left untouched.
 */
export async function migrateLegacyMeals(database: IDBDatabase): Promise<void> {
  const flag = await getAllRecords<MetaRow>(database, STORE_META)
  if (flag.some((row) => row.key === MEAL_MIGRATION_FLAG)) return

  const dinners = await getAllRecords<LegacyDinnerRow>(database, STORE_DINNER_LOGS)
  const days = await getAllRecords<LegacyDayRow>(database, STORE_DASHBOARD_DAYS)

  const meals: unknown[] = []

  for (const dinner of dinners) {
    if (!dinner.description?.trim()) continue
    meals.push({
      id: `legacy-dinner-${dinner.dateKey}`,
      dateKey: dinner.dateKey,
      kind: 'dinner',
      description: dinner.description,
      calories: Number.isFinite(dinner.calories) ? dinner.calories : 0,
      caloriesConfirmed: dinner.caloriesConfirmed === true,
      source: 'manual',
      createdAt: dinner.updatedAt,
    })
  }

  for (const day of days) {
    if (day.breakfast?.trim() || day.breakfastCalories !== undefined) {
      meals.push({
        id: `legacy-breakfast-${day.dateKey}`,
        dateKey: day.dateKey,
        kind: 'breakfast',
        description: day.breakfast?.trim() || '',
        calories: day.breakfastCalories ?? 0,
        caloriesConfirmed: day.breakfastCaloriesIsConfirmed === true,
        source: 'manual',
        createdAt: day.dateKey,
      })
    }
    if (day.lunchDescription?.trim() || day.lunchCalories !== undefined) {
      meals.push({
        id: `legacy-lunch-${day.dateKey}`,
        dateKey: day.dateKey,
        kind: 'lunch',
        description: day.lunchDescription?.trim() || '',
        calories: day.lunchCalories ?? 0,
        caloriesConfirmed: day.lunchCaloriesIsConfirmed === true,
        source: 'manual',
        createdAt: day.dateKey,
      })
    }
  }

  if (meals.length > 0) {
    await putRecords(database, STORE_MEAL_LOGS, meals)
  }
  await putRecords<MetaRow>(database, STORE_META, [
    { key: MEAL_MIGRATION_FLAG, value: new Date().toISOString() },
  ])
}
