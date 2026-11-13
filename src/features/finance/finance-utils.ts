import type { FinanceEntry } from '@/services/db'

export interface FinanceTotals {
  income: bigint
  expenses: bigint
  recordedSavings: bigint
  actualSavings: bigint
  budgetBalance: bigint
  savingsGoal: bigint
}

/** Monetary records use whole toman; BigInt keeps monthly totals and ratios exact. */
export function calculateFinanceTotals(
  entries: FinanceEntry[],
  savingsGoalBasisPoints: number
): FinanceTotals {
  const income = entries.reduce((sum, entry) => sum + (entry.type === 'income' ? BigInt(entry.amount) : 0n), 0n)
  const expenses = entries.reduce((sum, entry) => sum + (entry.type === 'expense' ? BigInt(entry.amount) : 0n), 0n)
  const recordedSavings = entries.reduce((sum, entry) => sum + (entry.type === 'saving' ? BigInt(entry.amount) : 0n), 0n)
  const budgetBalance = income - expenses - recordedSavings
  const savingsGoal = (income * BigInt(savingsGoalBasisPoints) + 5000n) / 10000n
  return { income, expenses, actualSavings: recordedSavings, recordedSavings, budgetBalance, savingsGoal }
}

export function parseWholeToman(value: string): number | null {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,\s]/g, '')
  if (!/^\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export interface DailyFinanceRow {
  dateKey: string
  income: bigint
  expenses: bigint
  savings: bigint
  /** Income minus expenses and savings of that day. */
  balance: bigint
}

/** Daily report of a month, newest day first. */
export function dailyFinanceRows(entries: FinanceEntry[]): DailyFinanceRow[] {
  const byDay = new Map<string, DailyFinanceRow>()
  for (const entry of entries) {
    const row = byDay.get(entry.date) ?? {
      dateKey: entry.date,
      income: 0n,
      expenses: 0n,
      savings: 0n,
      balance: 0n,
    }
    const amount = BigInt(entry.amount)
    if (entry.type === 'income') row.income += amount
    else if (entry.type === 'expense') row.expenses += amount
    else row.savings += amount
    row.balance = row.income - row.expenses - row.savings
    byDay.set(entry.date, row)
  }
  return [...byDay.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}

export interface CategoryTotal {
  category: string
  total: bigint
  count: number
}

/** Totals per category for one transaction type. */
export function categoryTotals(
  entries: FinanceEntry[],
  type: FinanceEntry['type']
): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>()
  for (const entry of entries) {
    if (entry.type !== type) continue
    const row = byCategory.get(entry.category) ?? {
      category: entry.category,
      total: 0n,
      count: 0,
    }
    row.total += BigInt(entry.amount)
    row.count += 1
    byCategory.set(entry.category, row)
  }
  return [...byCategory.values()].sort((a, b) =>
    a.total === b.total ? a.category.localeCompare(b.category) : b.total > a.total ? 1 : -1
  )
}

export interface MonthComparison {
  incomeDelta: bigint
  expenseDelta: bigint
  savingsDelta: bigint
  /** Direction of the expense trend compared with the previous month. */
  expenseTrend: 'up' | 'down' | 'flat'
}

/** Compares the current month with the previous one (all values exact). */
export function compareMonths(
  current: FinanceTotals,
  previous: FinanceTotals
): MonthComparison {
  const expenseDelta = current.expenses - previous.expenses
  return {
    incomeDelta: current.income - previous.income,
    expenseDelta,
    savingsDelta: current.actualSavings - previous.actualSavings,
    expenseTrend: expenseDelta > 0n ? 'up' : expenseDelta < 0n ? 'down' : 'flat',
  }
}

export interface MonthTrendPoint {
  monthKey: string
  expenses: bigint
  income: bigint
}

/** Expense/income trend over the given months, oldest month first. */
export function monthTrend(
  entriesByMonth: Array<{ monthKey: string; entries: FinanceEntry[] }>
): MonthTrendPoint[] {
  return entriesByMonth.map(({ monthKey, entries }) => ({
    monthKey,
    expenses: entries.reduce(
      (sum, entry) => sum + (entry.type === 'expense' ? BigInt(entry.amount) : 0n),
      0n
    ),
    income: entries.reduce(
      (sum, entry) => sum + (entry.type === 'income' ? BigInt(entry.amount) : 0n),
      0n
    ),
  }))
}

/** Percentage of the savings goal that is already reached (0–100). */
export function savingsGoalProgress(totals: FinanceTotals): number {
  if (totals.savingsGoal <= 0n) return 0
  const percent = (totals.actualSavings * 10000n) / totals.savingsGoal
  return Number(percent / 100n)
}
