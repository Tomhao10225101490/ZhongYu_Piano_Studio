/**
 * 按姓名关键字筛选学生（排课搜索、名单检索共用）
 * UTF-8
 */

import type { Student } from '../types/index'

function nameMatches(studentName: string, query: string): boolean {
  const n = studentName.trim()
  const q = query.trim()
  if (!q || !n) return false
  if (n.includes(q)) return true
  try {
    return n.toLowerCase().includes(q.toLowerCase())
  } catch {
    return false
  }
}

/** query 为空时返回全部（已按姓名排序）；否则返回匹配子集 */
export function filterStudentsByQuery(students: Student[], query: string): Student[] {
  const sorted = students.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const q = query.trim()
  if (!q) return sorted
  return sorted.filter((s) => nameMatches(s.name, q))
}

/** 仅用于非空关键字的联想列表（无匹配返回 []） */
export function matchStudentsForSuggest(students: Student[], query: string, max = 24): Student[] {
  const q = query.trim()
  if (!q) return []
  return filterStudentsByQuery(students, q).slice(0, max)
}
