import { describe, expect, it } from 'vitest'
import { calculateFinanceTotals, parseWholeToman } from '@/features/finance/finance-utils'
import type { FinanceEntry } from '@/services/db'

const entry = (type: FinanceEntry['type'], amount: number): FinanceEntry => ({
  id: `${type}-${amount}`, type, amount, date: '2026-10-01', monthKey: '2026-10',
  title: 'record', category: 'salary', createdAt: '', updatedAt: '',
})

describe('finance utilities', () => {
  it('calculates exact integer-toman totals and rounds the savings target', () => {
    expect(calculateFinanceTotals([entry('income', 10001), entry('expense', 4000)], 5000)).toEqual({
      income: 10001n, expenses: 4000n, actualSavings: 0n, recordedSavings: 0n, budgetBalance: 6001n, savingsGoal: 5001n,
    })
  })

  it('treats explicitly recorded savings as reserved budget', () => {
    const totals = calculateFinanceTotals([entry('income', 20000), entry('expense', 5000), entry('saving', 6000)], 5000)
    expect(totals.actualSavings).toBe(6000n)
    expect(totals.budgetBalance).toBe(9000n)
    expect(totals.savingsGoal).toBe(10000n)
  })

  it('parses Persian and grouped whole-toman amounts and rejects fractions', () => {
    expect(parseWholeToman('۱۲٬۳۴۵')).toBe(12345)
    expect(parseWholeToman('12,345')).toBe(12345)
    expect(parseWholeToman('12.5')).toBeNull()
    expect(parseWholeToman('0')).toBeNull()
  })
})
