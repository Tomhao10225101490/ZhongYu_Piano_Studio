/**
 * 日期范围：本周、今日等，供统计与课表图片使用
 * UTF-8
 */

export function getWeekRange(): [string, string] {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day
  const start = new Date(now)
  start.setDate(diff)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [fmt(start), fmt(end)]
}

export function getTodayStr(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** 当前自然月 [月初, 月末] YYYY-MM-DD */
export function getMonthRange(): [string, string] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const last = new Date(y, m, 0)
  const end = `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  return [start, end]
}

/** 日期 YYYY-MM-DD 转展示 3月12日 */
export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${m}月${d}日`
}

/** 本周范围展示 3月10日 - 3月16日 */
export function formatWeekRange([start, end]: [string, string]): string {
  return `${formatDateShort(start)} - ${formatDateShort(end)}`
}
