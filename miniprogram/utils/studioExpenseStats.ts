/**
 * 工作室支出汇总（按自然年）
 * UTF-8
 */

import type { StudioExpense } from '../types/index'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 是否为 YYYY-MM */
export function isValidYearMonth(s: string): boolean {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})$/)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12
}

export function expenseYear(ym: string): number | null {
  if (!isValidYearMonth(ym)) return null
  return Number(ym.slice(0, 4))
}

/**
 * 某自然年内登记的工作室支出合计（元）
 */
export function sumStudioExpensesForCalendarYear(expenses: StudioExpense[], year: number): number {
  if (!Number.isFinite(year)) return 0
  let sum = 0
  for (const e of expenses) {
    const y = expenseYear(e.yearMonth)
    if (y !== year) continue
    const a = Number(e.amount)
    if (Number.isFinite(a) && a > 0) sum += a
  }
  return round2(sum)
}

/** 某一归属月（YYYY-MM）内多条支出合计（元） */
export function sumStudioExpensesForYearMonth(expenses: StudioExpense[], yearMonth: string): number {
  const ym = String(yearMonth || '').trim()
  if (!ym) return 0
  let sum = 0
  for (const e of expenses) {
    if (e.yearMonth !== ym) continue
    const a = Number(e.amount)
    if (Number.isFinite(a) && a > 0) sum += a
  }
  return round2(sum)
}
