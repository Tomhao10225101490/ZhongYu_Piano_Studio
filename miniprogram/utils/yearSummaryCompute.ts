/**
 * 年度汇总展示数据（统计页与年度汇总页共用）
 * UTF-8
 */

import type { AppSettings, Course, Student, StudioExpense } from '../types/index'
import { listFeeDetailsInRange } from './feeStats'
import { sumStudioExpensesForCalendarYear } from './studioExpenseStats'

export interface YearSummaryDisplay {
  summaryYear: number
  summaryYearPickerValue: string
  yearStatCount: number
  yearTotalFee: string
  yearBossFee: string
  yearTeacherFee: string
  yearStudioExpense: string
  yearNetRevenue: string
  yearNetBoss: string
}

/**
 * 计算年度汇总展示字段（供 stats 与 year-summary 双页共用）。
 * 关键口径：
 * - yearNetRevenue = 总课时费 - 工作室支出
 * - yearNetBoss = 老板分成 - 工作室支出
 * - 教师分成不扣工作室固定支出
 */
export function computeYearSummaryDisplay(
  summaryYear: number,
  courses: Course[],
  students: Student[],
  settings: AppSettings,
  studioExpenses: StudioExpense[],
): YearSummaryDisplay {
  const year = Number(summaryYear) || new Date().getFullYear()
  const yearRange: [string, string] = [`${year}-01-01`, `${year}-12-31`]
  const yearStat = listFeeDetailsInRange(yearRange, courses, students, settings)
  const yearStudioTotal = sumStudioExpensesForCalendarYear(studioExpenses, year)
  /** 工作室固定支出仅由老板承担：只从老板所得扣除，教师分成不扣减 */
  const netRev = Math.round((yearStat.total - yearStudioTotal) * 100) / 100
  const netBoss = Math.round((yearStat.bossTotal - yearStudioTotal) * 100) / 100
  return {
    summaryYear: year,
    summaryYearPickerValue: `${year}-01-01`,
    yearStatCount: yearStat.rows.length,
    yearTotalFee: yearStat.total.toFixed(2),
    yearBossFee: yearStat.bossTotal.toFixed(2),
    yearTeacherFee: yearStat.teacherTotal.toFixed(2),
    yearStudioExpense: yearStudioTotal.toFixed(2),
    yearNetRevenue: netRev.toFixed(2),
    yearNetBoss: netBoss.toFixed(2),
  }
}
