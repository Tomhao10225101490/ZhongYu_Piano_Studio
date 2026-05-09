/**
 * 课时费统计：与统计页、费用分享图共用，保证算法一致
 * UTF-8
 */

import type { Course, Student, AppSettings } from '../types/index'
import { formatDateShort } from './dateRange'

const BASE_DURATION = 45
const DEFAULT_BOSS_SHARE_PERCENT = 0

/**
 * 按“每45分钟单价”折算任意时长课程费用，并立即 round2。
 * 说明：在单条明细处舍入，可减少长链路累计浮点误差。
 */
export function courseFeeForCourse(c: { duration: number }, pricePer45: number): number {
  return round2((pricePer45 / BASE_DURATION) * c.duration)
}

export function getStudentPriceMap(students: Student[]): Record<string, number> {
  const map: Record<string, number> = {}
  students.forEach((s) => {
    const price = Number(s.pricePerClass || 0)
    if (s.name && Number.isFinite(price) && price > 0) {
      map[s.name] = price
    }
  })
  return map
}

export function clamp0To100(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function getStudentBossShareMap(students: Student[]): Record<string, number> {
  const map: Record<string, number> = {}
  students.forEach((s) => {
    if (!s.name) return
    const p = Number(s.bossSharePercent)
    if (Number.isFinite(p)) {
      map[s.name] = clamp0To100(Math.floor(p))
    }
  })
  return map
}

export function splitFeeByBossPercent(
  fee: number,
  bossSharePercent: number,
): { bossFee: number; teacherFee: number } {
  const p = clamp0To100(bossSharePercent)
  const bossFee = round2((fee * p) / 100)
  const teacherFee = round2(fee - bossFee)
  return { bossFee, teacherFee }
}

export function inRangeDate(date: string, [start, end]: [string, string]): boolean {
  return date >= start && date <= end
}

export interface FeeDetailRow {
  course: Course
  fee: number
  /** 本行采用的单价（元/45 分钟） */
  pricePer45: number
  /** 是否为学生专属单价（否则为全局基准） */
  useCustomPrice: boolean
  /** 本行采用的老板分成比例（学生专属优先，未设走全局） */
  bossSharePercent: number
  bossFee: number
  teacherFee: number
}

/**
 * 统计区间费用明细与汇总。
 * 口径：
 * - 单价：学生专属 > 全局单价
 * - 分成：学生专属 > 全局分成
 * - 汇总：每步累加都 round2，确保展示与导出一致
 */
export function listFeeDetailsInRange(
  range: [string, string],
  courses: Course[],
  students: Student[],
  settings: AppSettings,
): {
  rows: FeeDetailRow[]
  total: number
  bossTotal: number
  teacherTotal: number
  globalPrice: number
  globalBossSharePercent: number
} {
  const studentPriceMap = getStudentPriceMap(students)
  const studentBossShareMap = getStudentBossShareMap(students)
  const globalPrice = settings.pricePerClass ?? 0
  const globalBossSharePercent = clamp0To100(Number(settings.bossSharePercent ?? DEFAULT_BOSS_SHARE_PERCENT))
  const sorted = courses
    .filter((c) => inRangeDate(c.date, range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
  const rows: FeeDetailRow[] = []
  let total = 0
  let bossTotal = 0
  let teacherTotal = 0
  for (const c of sorted) {
    const per45 = studentPriceMap[c.studentName] ?? globalPrice
    const fee = per45 ? courseFeeForCourse(c, per45) : 0
    const bossSharePercent = studentBossShareMap[c.studentName] ?? globalBossSharePercent
    const { bossFee, teacherFee } = splitFeeByBossPercent(fee, bossSharePercent)
    total = round2(total + fee)
    bossTotal = round2(bossTotal + bossFee)
    teacherTotal = round2(teacherTotal + teacherFee)
    const useCustomPrice =
      Object.prototype.hasOwnProperty.call(studentPriceMap, c.studentName) &&
      Number(studentPriceMap[c.studentName]) > 0
    rows.push({
      course: c,
      fee,
      pricePer45: per45,
      useCustomPrice,
      bossSharePercent,
      bossFee,
      teacherFee,
    })
  }
  return { rows, total, bossTotal, teacherTotal, globalPrice, globalBossSharePercent }
}

export function buildFeeShareText(
  title: string,
  range: [string, string],
  courses: Course[],
  students: Student[],
  settings: AppSettings,
): string {
  const { rows, total, bossTotal, teacherTotal, globalPrice, globalBossSharePercent } = listFeeDetailsInRange(
    range,
    courses,
    students,
    settings,
  )
  const [start, end] = range
  const rangeStr = `${formatDateShort(start)}～${formatDateShort(end)}`
  if (!rows.length) {
    return `${title}（${rangeStr}）\n暂无课程`
  }
  const lines = rows.map(({ course: c, fee, pricePer45, bossSharePercent, bossFee, teacherFee }) => {
    const std = pricePer45 > 0 ? `${pricePer45}元/45分钟` : '未设单价'
    return `${formatDateShort(c.date)} ${c.startTime} ${c.studentName} ${c.duration}分钟 ${std} 总¥${fee.toFixed(2)}（老板${bossSharePercent}% ¥${bossFee.toFixed(2)} / 教师 ¥${teacherFee.toFixed(2)}）`
  })
  return (
    `${title}（${rangeStr}）\n` +
    `上课 ${rows.length} 节，课时费合计 ¥${total.toFixed(2)}\n` +
    `老板所得 ¥${bossTotal.toFixed(2)}，教师所得 ¥${teacherTotal.toFixed(2)}\n` +
    `（基准单价 ${globalPrice} 元/45 分钟；全局老板分成 ${globalBossSharePercent}%；学生可设专属单价/分成）\n` +
    `明细：\n` +
    lines.join('\n')
  )
}
