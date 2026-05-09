/**
 * 排课核心逻辑：时间片冲突检测、自动顺延
 * UTF-8
 */

import type { Course } from '../types/index'
import { getCourses, setCourses } from './storage'

/** 时间 HH:mm 转当日分钟数 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 分钟数转 HH:mm */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * 判断该节课是否已上完（结束时间已过则不可删除）
 * @param date 日期 YYYY-MM-DD
 * @param startTime 开始时间 HH:mm
 * @param duration 时长（分钟）
 */
export function isCourseFinished(date: string, startTime: string, duration: number): boolean {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (date < today) return true
  if (date > today) return false
  const endMinutes = timeToMinutes(startTime) + duration
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  return currentMinutes >= endMinutes
}

/**
 * 时间片冲突检测：判断 [start, start+duration) 与同一天已有课程是否重叠
 * @param date 日期 YYYY-MM-DD
 * @param startTime 开始时间 HH:mm
 * @param duration 时长（分钟）
 * @param excludeCourseId 排除的课程 ID（编辑时排除自身）
 */
export function hasConflict(
  date: string,
  startTime: string,
  duration: number,
  excludeCourseId?: string
): boolean {
  const all = getCourses()
  const start = timeToMinutes(startTime)
  const end = start + duration

  for (const c of all) {
    if (c.date !== date || c.id === excludeCourseId) continue
    const cStart = timeToMinutes(c.startTime)
    const cEnd = cStart + c.duration
    // 重叠条件：两段区间相交
    if (start < cEnd && end > cStart) return true
  }
  return false
}

/**
 * 冲突检测，排除多个课程 ID（用于两课对调等）
 */
export function hasConflictExcluding(
  date: string,
  startTime: string,
  duration: number,
  excludeIds: string[]
): boolean {
  const exclude = new Set(excludeIds)
  const all = getCourses()
  const start = timeToMinutes(startTime)
  const end = start + duration
  for (const c of all) {
    if (c.date !== date || exclude.has(c.id)) continue
    const cStart = timeToMinutes(c.startTime)
    const cEnd = cStart + c.duration
    if (start < cEnd && end > cStart) return true
  }
  return false
}

/**
 * 【核心】自动顺延：修改某课程的时间/时长后，当天排在其后的所有课程自动顺延，避免重叠
 * 规则：从被修改的课程开始，按开始时间排序，每节课的 start = max(原start, 前一节的结束时间)
 * @param courseId 被修改的课程 ID
 * @param newStartTime 新开始时间
 * @param newDuration 新时长
 * @return 更新后的当日全部课程（已写回 storage）
 */
export function autoShiftAfterUpdate(
  courseId: string,
  newStartTime: string,
  newDuration: number
): Course[] {
  const all = getCourses()
  const target = all.find((c) => c.id === courseId)
  if (!target) return []

  const date = target.date
  let dayCourses = all.filter((c) => c.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime))

  const idx = dayCourses.findIndex((c) => c.id === courseId)
  if (idx < 0) return dayCourses

  // 更新目标课程
  dayCourses[idx] = { ...dayCourses[idx], startTime: newStartTime, duration: newDuration }
  let prevEnd = timeToMinutes(newStartTime) + newDuration

  // 顺延其后所有课程：
  // 仅在“当前课程会与上一节结束重叠”时改写 startTime，并记录可恢复锚点。
  for (let i = idx + 1; i < dayCourses.length; i++) {
    const c = dayCourses[i]
    const cStart = timeToMinutes(c.startTime)
    if (cStart < prevEnd) {
      const newStart = minutesToTime(prevEnd)
      dayCourses[i] = {
        ...c,
        preShiftStartTime: c.preShiftStartTime || c.startTime,
        shiftedByCourseId: courseId,
        startTime: newStart,
      }
      prevEnd += c.duration
    } else {
      prevEnd = cStart + c.duration
    }
  }

  // 写回：合并其他日期的课程
  const other = all.filter((c) => c.date !== date)
  const merged = [...other, ...dayCourses]
  setCourses(merged)
  return dayCourses
}

/**
 * 获取某课程导致的“可恢复顺延”后续课程数量
 */
export function getRestorableShiftCount(courseId: string): number {
  const all = getCourses()
  const target = all.find((c) => c.id === courseId)
  if (!target) return 0
  return all.filter((c) =>
    c.date === target.date &&
    c.id !== courseId &&
    c.shiftedByCourseId === courseId &&
    !!c.preShiftStartTime &&
    timeToMinutes(c.startTime) > timeToMinutes(c.preShiftStartTime)
  ).length
}

/**
 * 当导致顺延的课程被提前后，恢复其后续课程到顺延前时间
 * 仅恢复 shiftedByCourseId=courseId 且存在 preShiftStartTime 的课程
 */
/**
 * 恢复由某课程触发的顺延链。
 * 先还原 preShiftStartTime，再做一次最小化重排，保证恢复后仍无重叠。
 */
export function restoreShiftedFollowersAfterUpdate(
  courseId: string,
  newStartTime: string,
  newDuration: number
): Course[] {
  const all = getCourses()
  const target = all.find((c) => c.id === courseId)
  if (!target) return []
  const date = target.date
  const dayCourses = all
    .filter((c) => c.date === date)
    .map((c) => {
      if (c.id === courseId) {
        return { ...c, startTime: newStartTime, duration: newDuration }
      }
      if (c.shiftedByCourseId === courseId && c.preShiftStartTime) {
        return {
          ...c,
          startTime: c.preShiftStartTime,
          preShiftStartTime: undefined,
          shiftedByCourseId: undefined,
        }
      }
      return c
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  // 恢复后兜底：若仍有重叠，按当前顺序最小化顺延
  for (let i = 1; i < dayCourses.length; i++) {
    const prev = dayCourses[i - 1]
    const curr = dayCourses[i]
    const prevEnd = timeToMinutes(prev.startTime) + prev.duration
    const currStart = timeToMinutes(curr.startTime)
    if (currStart < prevEnd) {
      dayCourses[i] = { ...curr, startTime: minutesToTime(prevEnd) }
    }
  }

  const other = all.filter((c) => c.date !== date)
  setCourses([...other, ...dayCourses])
  return dayCourses
}

/**
 * 按既定顺序（通常已是时间顺序）逐节紧凑排布：每节开始 = max(原开始, 上一节结束)
 */
function packDaySequential(ordered: Course[]): Course[] {
  const result: Course[] = []
  let prevEnd = 0
  for (const c of ordered) {
    const cStart = timeToMinutes(c.startTime)
    const start = Math.max(cStart, prevEnd)
    result.push({ ...c, startTime: minutesToTime(start) })
    prevEnd = start + c.duration
  }
  return result
}

/**
 * 在指定日期、时间新增课程；若与已有课程重叠则自动顺延当日后续课程
 * @param afterCourseId 若传入，则新课程插在该课结束之后
 */
/**
 * 插入新课并重排当日时间轴。
 * 语义：新课优先占用选定时刻，同刻度的旧课后移，最终确保全日无重叠。
 */
export function insertCourseAndShift(
  date: string,
  startTime: string,
  duration: number,
  studentName: string,
  studentColor?: string,
  afterCourseId?: string
): Course {
  const { nextId: genId } = require('./storage')
  const id = genId()
  let insertStart = startTime
  const all = getCourses()
  let dayCourses = all.filter((c) => c.date === date)

  if (afterCourseId) {
    const after = dayCourses.find((c) => c.id === afterCourseId)
    if (after) insertStart = minutesToTime(timeToMinutes(after.startTime) + after.duration)
  }

  const newCourse: Course = {
    id,
    date,
    startTime: insertStart,
    duration,
    studentName,
    studentColor,
  }
  const insertMin = timeToMinutes(insertStart)
  const before = dayCourses
    .filter((c) => timeToMinutes(c.startTime) < insertMin)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const sameStart = dayCourses
    .filter((c) => timeToMinutes(c.startTime) === insertMin)
    .sort((a, b) => a.id.localeCompare(b.id))
  const after = dayCourses
    .filter((c) => timeToMinutes(c.startTime) > insertMin)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  // 插入课程：新课紧挨排在「同开始时刻」的已有课之前，再整体顺延，保证新课占住所选时刻
  const ordered = [...before, newCourse, ...sameStart, ...after]
  const merged = packDaySequential(ordered)
  const others = all.filter((c) => c.date !== date)
  setCourses([...others, ...merged])
  const added = merged.find((c) => c.id === id)!
  return added
}

/**
 * 判断两门课可否互换开始时间（同一天、时长相同、且不与第三方课程冲突）
 */
export function canSwapCourseTimeSlots(sourceId: string, targetId: string): boolean {
  const all = getCourses()
  const a = all.find((c) => c.id === sourceId)
  const b = all.find((c) => c.id === targetId)
  if (!a || !b || a.date !== b.date) return false
  if (a.duration !== b.duration) return false
  const ex = [sourceId, targetId]
  if (hasConflictExcluding(a.date, b.startTime, a.duration, ex)) return false
  if (hasConflictExcluding(a.date, a.startTime, b.duration, ex)) return false
  return true
}

/**
 * 互换两门课的开始时间；清除顺延标记；不满足 canSwap 时返回 false
 */
export function swapCourseTimeSlots(sourceId: string, targetId: string): boolean {
  if (!canSwapCourseTimeSlots(sourceId, targetId)) return false
  const all = getCourses()
  const a = all.find((c) => c.id === sourceId)!
  const b = all.find((c) => c.id === targetId)!
  const startA = a.startTime
  const startB = b.startTime
  const next = all.map((c) => {
    if (c.id === sourceId) {
      return {
        ...c,
        startTime: startB,
        preShiftStartTime: undefined,
        shiftedByCourseId: undefined,
      }
    }
    if (c.id === targetId) {
      return {
        ...c,
        startTime: startA,
        preShiftStartTime: undefined,
        shiftedByCourseId: undefined,
      }
    }
    return c
  })
  setCourses(next)
  return true
}
