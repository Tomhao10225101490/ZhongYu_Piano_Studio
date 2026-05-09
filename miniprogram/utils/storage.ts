/**
 * 本地存储封装 - 纯前端，零后端
 * 使用 wx.setStorageSync / wx.getStorageSync
 * UTF-8
 */

import type {
  Course,
  Student,
  AppSettings,
  AuthState,
  RestoreSnapshot,
  UserProfileInfo,
  StudioExpense,
} from '../types/index'

const KEY_COURSES = 'piano_courses'
const KEY_STUDENTS = 'piano_students'
const KEY_SETTINGS = 'piano_settings'
const KEY_STUDIO_EXPENSES = 'piano_studio_expenses'
const KEY_AUTH_STATE = 'piano_auth_state'
const KEY_RESTORE_SNAPSHOT = 'piano_restore_snapshot'
const KEY_USER_PROFILE = 'piano_user_profile'
const KEY_BOSS_STATUS = 'piano_boss_status'
const KEY_BOSS_VIEW_IS_SELF = 'piano_boss_view_is_self'
const KEY_BOSS_VIEW_TEACHER = 'piano_boss_view_teacher'
const GUEST_SCOPE = 'guest'

function hasStorageKey(key: string): boolean {
  try {
    const info = wx.getStorageInfoSync()
    return info.keys.includes(key)
  } catch {
    return false
  }
}

/**
 * 计算“按账号作用域隔离”的存储键。
 * - 已登录：baseKey__openid
 * - 游客：baseKey__guest
 */
function scopedKey(baseKey: string): string {
  const openid = getCurrentUserOpenid()
  const scope = openid || GUEST_SCOPE
  return `${baseKey}__${scope}`
}

/**
 * 启动期兼容迁移：
 * 将历史“未分作用域”的旧键迁移到 guest 作用域，避免老数据丢失。
 */
function migrateLegacyData(baseKey: string): void {
  const legacyKey = baseKey
  const guestKey = `${baseKey}__${GUEST_SCOPE}`
  if (!hasStorageKey(legacyKey) || hasStorageKey(guestKey)) return
  try {
    const legacy = wx.getStorageSync(legacyKey)
    wx.setStorageSync(guestKey, legacy)
    wx.removeStorageSync(legacyKey)
  } catch {
    // ignore migrate failures and keep app usable
  }
}

/** 获取所有课程 */
export function getCourses(): Course[] {
  migrateLegacyData(KEY_COURSES)
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_COURSES))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** 保存所有课程 */
export function setCourses(courses: Course[]): void {
  wx.setStorageSync(scopedKey(KEY_COURSES), courses)
}

/** 获取某日课程（已按开始时间排序） */
export function getCoursesByDate(date: string): Course[] {
  const all = getCourses()
  return all
    .filter((c) => c.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** 获取学生列表 */
export function getStudents(): Student[] {
  migrateLegacyData(KEY_STUDENTS)
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_STUDENTS))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** 保存学生列表 */
export function setStudents(students: Student[]): void {
  wx.setStorageSync(scopedKey(KEY_STUDENTS), students)
}

/** 获取设置 */
export function getSettings(): AppSettings {
  migrateLegacyData(KEY_SETTINGS)
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_SETTINGS))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** 保存设置 */
export function setSettings(settings: AppSettings): void {
  wx.setStorageSync(scopedKey(KEY_SETTINGS), settings)
}

/** 工作室支出列表 */
export function getStudioExpenses(): StudioExpense[] {
  migrateLegacyData(KEY_STUDIO_EXPENSES)
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_STUDIO_EXPENSES))
    return Array.isArray(raw) ? (raw as StudioExpense[]) : []
  } catch {
    return []
  }
}

export function setStudioExpenses(items: StudioExpense[]): void {
  wx.setStorageSync(scopedKey(KEY_STUDIO_EXPENSES), items)
}

/** 获取登录态 */
/**
 * 读取并校验本地登录态。
 * 返回 null 表示结构不合法或关键字段缺失，不代表“网络下线”。
 */
export function getAuthState(): AuthState | null {
  try {
    const raw = wx.getStorageSync(KEY_AUTH_STATE)
    if (!raw || typeof raw !== 'object') return null
    const state = raw as Partial<AuthState>
    const expiresAt = Number(state.expiresAt)
    if (!state.openid || !state.authToken || !Number.isFinite(expiresAt) || expiresAt < 0) return null
    return {
      openid: state.openid,
      authToken: state.authToken,
      expiresAt,
    }
  } catch {
    return null
  }
}

/** 当前数据作用域对应的 openid（未登录返回空） */
export function getCurrentUserOpenid(): string {
  const state = getAuthState()
  return state?.openid || ''
}

/** 保存登录态 */
export function setAuthState(state: AuthState): void {
  wx.setStorageSync(KEY_AUTH_STATE, state)
}

/** 清空登录态 */
export function clearAuthState(): void {
  wx.removeStorageSync(KEY_AUTH_STATE)
}

/** 保存恢复前快照（按用户作用域） */
export function setRestoreSnapshot(snapshot: RestoreSnapshot): void {
  wx.setStorageSync(scopedKey(KEY_RESTORE_SNAPSHOT), snapshot)
}

/** 获取恢复前快照（按用户作用域） */
export function getRestoreSnapshot(): RestoreSnapshot | null {
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_RESTORE_SNAPSHOT))
    if (!raw || typeof raw !== 'object') return null
    const parsed = raw as Partial<RestoreSnapshot>
    if (!Array.isArray(parsed.courses) || !Array.isArray(parsed.students) || typeof parsed.snapshotAt !== 'string') {
      return null
    }
    const studioExpenses = Array.isArray(parsed.studioExpenses) ? (parsed.studioExpenses as StudioExpense[]) : undefined
    return {
      courses: parsed.courses as Course[],
      students: parsed.students as Student[],
      settings: parsed.settings && typeof parsed.settings === 'object' ? (parsed.settings as AppSettings) : {},
      studioExpenses,
      snapshotAt: parsed.snapshotAt,
    }
  } catch {
    return null
  }
}

/** 清空恢复前快照（按用户作用域） */
export function clearRestoreSnapshot(): void {
  wx.removeStorageSync(scopedKey(KEY_RESTORE_SNAPSHOT))
}

/** 保存当前账号用户资料（按用户作用域） */
export function setUserProfileInfo(profile: UserProfileInfo): void {
  wx.setStorageSync(scopedKey(KEY_USER_PROFILE), profile)
}

/** 获取当前账号用户资料（按用户作用域） */
export function getUserProfileInfo(): UserProfileInfo | null {
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_USER_PROFILE))
    if (!raw || typeof raw !== 'object') return null
    const p = raw as Partial<UserProfileInfo>
    if (!p.nickName || !p.avatarUrl || !p.updatedAt) return null
    return {
      nickName: p.nickName,
      avatarUrl: p.avatarUrl,
      gender: p.gender,
      country: p.country,
      province: p.province,
      city: p.city,
      language: p.language,
      updatedAt: p.updatedAt,
    }
  } catch {
    return null
  }
}

/** 当前账号是否为“老板认证”模式（仅本地缓存，按 openid 作用域隔离） */
export function getBossStatus(): boolean {
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_BOSS_STATUS))
    return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'boss'
  } catch {
    return false
  }
}

/** 设置当前账号是否为“老板认证”模式 */
export function setBossStatus(isBoss: boolean): void {
  wx.setStorageSync(scopedKey(KEY_BOSS_STATUS), !!isBoss)
}

/** 当前老板是否正在“查看自己的数据”（当查看别的老师数据时为 false） */
/**
 * 老板视图当前是否为“查看自己”。
 * 兼容语义：历史缺省值按 true 处理，避免冷启动误判为“代看他人”。
 */
export function getBossViewIsSelf(): boolean {
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_BOSS_VIEW_IS_SELF))
    if (raw === undefined || raw === null || raw === '') return true
    return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'self'
  } catch {
    return true
  }
}

export function setBossViewIsSelf(isSelf: boolean): void {
  wx.setStorageSync(scopedKey(KEY_BOSS_VIEW_IS_SELF), !!isSelf)
}

export interface BossViewingTeacherInfo {
  nickName: string
  ownerKey?: string
  avatarUrl?: string
}

/** 当前老板正在查看的老师信息（用于月/周/统计顶部标识） */
/**
 * 读取当前老板正在查看的老师元信息（昵称/ownerKey/头像）。
 * 用途：顶部“正在查看谁”的 UI 文案与后续云端拉取定位。
 */
export function getBossViewingTeacherInfo(): BossViewingTeacherInfo | null {
  try {
    const raw = wx.getStorageSync(scopedKey(KEY_BOSS_VIEW_TEACHER))
    if (!raw || typeof raw !== 'object') return null
    const v = raw as Partial<BossViewingTeacherInfo>
    const nickName = typeof v.nickName === 'string' ? v.nickName.trim() : ''
    if (!nickName) return null
    const ownerKey = typeof v.ownerKey === 'string' ? v.ownerKey.trim() : ''
    const avatarUrl = typeof v.avatarUrl === 'string' ? v.avatarUrl.trim() : ''
    return {
      nickName,
      ownerKey: ownerKey || undefined,
      avatarUrl: avatarUrl || undefined,
    }
  } catch {
    return null
  }
}

export function setBossViewingTeacherInfo(info: BossViewingTeacherInfo | null): void {
  if (!info) {
    wx.removeStorageSync(scopedKey(KEY_BOSS_VIEW_TEACHER))
    return
  }
  wx.setStorageSync(scopedKey(KEY_BOSS_VIEW_TEACHER), info)
}

/** 生成唯一 ID */
export function nextId(): string {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
}
