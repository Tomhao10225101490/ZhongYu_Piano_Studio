import { getValidAuthToken, loginWithServer } from './auth'
import { getBackupServerBase } from './server'
import {
  getBossStatus,
  getBossViewingTeacherInfo,
  getCourses,
  getCurrentUserOpenid,
  getSettings,
  getStudents,
  getStudioExpenses,
  getUserProfileInfo,
  setRestoreSnapshot,
} from './storage'
import type { AppSettings, Course, Student, StudioExpense, UserProfileInfo } from '../types/index'
import { isBossUser, isBossViewingSelf } from './boss'

export interface LatestBackupResponse {
  success?: boolean
  message?: string
  backupAt?: string
  courses?: Course[]
  students?: Student[]
  settings?: AppSettings
  studioExpenses?: StudioExpense[]
}

/**
 * 当本地有新改动但自动备份失败（网络/鉴权波动）时置为 true；
 * 随后在 app/页面 onShow 时尝试 drain，避免"老师以为已同步、老板看不到"的场景。
 */
let hasPendingLocalBackup = false
let pendingDrainInFlight: Promise<boolean> | null = null
let tokenRefreshInFlight: Promise<boolean> | null = null

function saveLocalSnapshotBeforeBackup(): void {
  try {
    // 快照作用：在“误恢复/误覆盖”后可通过“撤销恢复”回到上传前本地状态
    setRestoreSnapshot({
      courses: getCourses(),
      students: getStudents(),
      settings: getSettings(),
      studioExpenses: getStudioExpenses(),
      snapshotAt: new Date().toISOString(),
    })
  } catch {
    // 快照保存失败不应阻断正常备份
  }
}

/**
 * 获取可用于云同步写请求的 token。
 * - 若本地 token 有效，直接返回。
 * - 若已过期，则触发一次“单飞”续登；并发请求复用同一个续登 Promise。
 * - 返回空字符串代表当前无法安全发起写请求（未配置服务端/续登失败）。
 */
async function ensureAuthTokenForSync(): Promise<string> {
  const cur = getValidAuthToken()
  if (cur) return cur
  if (tokenRefreshInFlight) {
    const ok = await tokenRefreshInFlight
    return ok ? getValidAuthToken() : ''
  }
  const baseUrl = getBackupServerBase()
  if (!baseUrl) return ''
  // 单飞刷新：同一时刻仅一次续登请求，避免并发续登互相覆盖登录态
  tokenRefreshInFlight = loginWithServer(baseUrl)
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      tokenRefreshInFlight = null
    })
  const ok = await tokenRefreshInFlight
  return ok ? getValidAuthToken() : ''
}

export function markLocalBackupPending(): void {
  hasPendingLocalBackup = true
}

export function hasPendingCloudBackup(): boolean {
  return hasPendingLocalBackup
}

/**
 * 把当前“本机权威数据”整包备份到云端。
 * 副作用：
 * - 上传前写入 restore 快照（用于误恢复回滚）。
 * - 失败时置 pending，后续由 drain 机制重试。
 * 边界：
 * - 老板代看他人时禁止全量上传，避免覆盖对方课表/学生。
 */
export function backupCurrentUserToCloud(): Promise<boolean> {
  if (isBossUser() && !isBossViewingSelf()) return Promise.resolve(false)
  return (async () => {
    // 上传前先留本地快照，便于后续一键回滚
    saveLocalSnapshotBeforeBackup()
    const token = await ensureAuthTokenForSync()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) {
      // 未登录或续登失败：保留 pending，后续 onShow 继续重试
      hasPendingLocalBackup = true
      return false
    }

    // 拷贝后再改,避免误改本地缓存引用；且须把 bossCertified:false 原样上传以便跨设备退出生效
    const settings: AppSettings = { ...getSettings() }
    if (getBossStatus() && settings.bossCertified !== true) {
      settings.bossCertified = true
    }
    return new Promise<boolean>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/backup`,
        method: 'POST',
        timeout: 12000,
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        data: {
          courses: getCourses(),
          students: getStudents(),
          settings,
          studioExpenses: getStudioExpenses(),
        },
        success: (res) => {
          const data = (res.data || {}) as { success?: boolean }
          const ok = !!data.success
          if (ok) hasPendingLocalBackup = false
          else hasPendingLocalBackup = true
          resolve(ok)
        },
        fail: () => {
          hasPendingLocalBackup = true
          resolve(false)
        },
      })
    })
  })()
}

/**
 * 若上次自动备份失败,则尝试重新备份一次。
 * 适合在 app/页面 onShow 时调用;带单飞保护,避免并发。
 */
/**
 * 补偿上传入口：若本地存在 pending 备份标记，尝试重传一次。
 * 典型调用时机：app/page onShow。
 * 并发语义：单飞，避免同一时刻重复补传。
 */
export function drainPendingCloudBackup(): Promise<boolean> {
  if (!hasPendingLocalBackup) return Promise.resolve(false)
  if (isBossUser() && !isBossViewingSelf()) return Promise.resolve(false)
  if (pendingDrainInFlight) return pendingDrainInFlight
  // 单飞补偿：pending 存在时最多并发一次补同步
  const p = backupCurrentUserToCloud().finally(() => {
    pendingDrainInFlight = null
  })
  pendingDrainInFlight = p
  return p
}

/**
 * 老板查看其他老师时：把当前本地工作室支出写入「该老师」的云端备份（不覆盖其课表/学生）。
 * teacherOwnerKey 须为对方 openid（与 boss 切换老师时写入的 ownerKey 一致）。
 */
export function pushTargetStudioExpensesToCloud(
  teacherOwnerKey: string,
  studioExpenses: StudioExpense[],
): Promise<boolean> {
  return (async () => {
    const token = await ensureAuthTokenForSync()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) return false
    const targetOpenid = String(teacherOwnerKey || '').trim()
    if (!targetOpenid) return false
    return new Promise<boolean>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/backup/target-studio-expenses`,
        method: 'POST',
        timeout: 12000,
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        data: { targetOpenid, studioExpenses },
        success: (res) => {
          const data = (res.data || {}) as { success?: boolean }
          resolve(!!data.success)
        },
        fail: () => resolve(false),
      })
    })
  })()
}

/** 工作室支出保存/删除后：本人走全量备份；老板代看他人时仅推 studioExpenses 到对方备份 */
export function syncStudioExpensesAfterLocalChange(): Promise<boolean> {
  // 老板代看他人：只能改工作室支出，不允许覆盖对方课表/学生
  if (isBossUser() && !isBossViewingSelf()) {
    const key = String(getBossViewingTeacherInfo()?.ownerKey || '').trim()
    if (!key) return Promise.resolve(false)
    return pushTargetStudioExpensesToCloud(key, getStudioExpenses())
  }
  return backupCurrentUserToCloud()
}

/**
 * 读取当前账号最新云备份（只读接口）。
 * 注意：此处不做静默续登，避免读请求因续登失败而产生“隐性失败路径”。
 */
export function fetchLatestBackupFromCloud(): Promise<LatestBackupResponse | null> {
  return (async () => {
    const token = getValidAuthToken()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) return null
    return new Promise<LatestBackupResponse | null>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/backup/latest`,
        method: 'GET',
        timeout: 12000,
        header: {
          Authorization: `Bearer ${token}`,
        },
        success: (res) => resolve((res.data || {}) as LatestBackupResponse),
        fail: () => resolve(null),
      })
    })
  })()
}

export type BossTeacherItem = {
  profile: Pick<UserProfileInfo, 'nickName' | 'avatarUrl'>
  /** 服务端提供的老师标识（优先 openid/teacherId 等），用于判断是否为自己 */
  ownerKey?: string
  /** 最近备份时间（ISO 字符串） */
  backupAt?: string
  courses: Course[]
  students: Student[]
  settings: AppSettings
  studioExpenses: StudioExpense[]
}

/**
 * 老板视图：复用现有 `/api/backup/latest`。
 * - 若服务器返回 `teachers: []`，则按老师维度解析
 * - 否则退化为仅当前老师（无法拿到其他老师的昵称/头像）
 */
export type BossLatestMineBundle = {
  courses: Course[]
  students: Student[]
  settings: AppSettings
  studioExpenses: StudioExpense[]
}

/**
 * 获取老板模式下的老师列表与本人顶层数据。
 * 兼容策略：
 * - 不同后端字段命名差异（teachers/teacherList/users/list...）统一归一化。
 * - 若服务端未返回老师列表，回退为“仅当前账号”一行，保证页面可用。
 */
export function fetchBossTeachersFromCloud(): Promise<{
  success: boolean
  teachers: BossTeacherItem[]
  /** 当前登录用户在云端备份里的课表/学生/设置（老板接口顶层 mine） */
  mine?: BossLatestMineBundle
}> {
  const buildMine = (data: any): BossLatestMineBundle => ({
    courses: Array.isArray(data.courses) ? (data.courses as Course[]) : [],
    students: Array.isArray(data.students) ? (data.students as Student[]) : [],
    settings: data.settings && typeof data.settings === 'object' ? (data.settings as AppSettings) : ({} as AppSettings),
    studioExpenses: Array.isArray(data.studioExpenses) ? (data.studioExpenses as StudioExpense[]) : [],
  })

  return (async () => {
    const token = getValidAuthToken()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) return { success: false, teachers: [] }
    return new Promise<{
      success: boolean
      teachers: BossTeacherItem[]
      mine?: BossLatestMineBundle
    }>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/backup/latest`,
        method: 'GET',
        timeout: 12000,
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          const data = (res.data || {}) as any
        const asArray = (v: any): any[] => (Array.isArray(v) ? v : [])
        const pickFirstArray = (...vals: any[]): any[] => {
          for (const v of vals) {
            if (Array.isArray(v) && v.length) return v
          }
          return []
        }
        const normalizeTeacher = (t: any): BossTeacherItem => {
          const profile = t?.profile || t?.user || t?.teacher || t?.teacherProfile || {}
          const nickName = String(
            profile?.nickName ??
              profile?.nickname ??
              profile?.name ??
              t?.nickName ??
              t?.nickname ??
              t?.name ??
              t?.userName ??
              t?.displayName ??
              '',
          ).trim() || '老师'
          const avatarUrl = String(
            profile?.avatarUrl ??
              profile?.avatar ??
              profile?.headImgUrl ??
              profile?.headimgurl ??
              profile?.photo ??
              t?.avatarUrl ??
              t?.avatar ??
              t?.headImgUrl ??
              t?.headimgurl ??
              t?.photo ??
              '',
          ).trim()
          const ownerKey =
            String(
              t?.openid ??
                t?.ownerOpenid ??
                t?.teacherOpenid ??
                t?.teacherId ??
                t?.userId ??
                t?.id ??
                profile?.openid ??
                profile?.id ??
                '',
            ).trim() || undefined

          const backup = t?.backup || t?.latestBackup || {}
          const courses = pickFirstArray(
            t?.courses,
            t?.courseList,
            t?.schedule,
            t?.schedules,
            backup?.courses,
            backup?.courseList,
          ) as Course[]
          const students = pickFirstArray(
            t?.students,
            t?.studentList,
            backup?.students,
            backup?.studentList,
          ) as Student[]
          const settings =
            (t?.settings && typeof t.settings === 'object' ? t.settings : null) ||
            (backup?.settings && typeof backup.settings === 'object' ? backup.settings : null) ||
            ({} as AppSettings)
          const studioExpenses = (
            Array.isArray(t?.studioExpenses)
              ? t.studioExpenses
              : Array.isArray(backup?.studioExpenses)
                ? backup.studioExpenses
                : []
          ) as StudioExpense[]
          const backupAt = String(t?.backupAt || backup?.backupAt || '').trim()

          return {
            profile: { nickName, avatarUrl },
            ownerKey,
            backupAt: backupAt || undefined,
            courses,
            students,
            settings: settings as AppSettings,
            studioExpenses,
          }
        }

        const dataWrap = data?.data || {}
        try {
          console.info('[boss] /api/backup/latest top-level keys:', Object.keys(data || {}))
          if (dataWrap && typeof dataWrap === 'object') {
            console.info('[boss] /api/backup/latest data keys:', Object.keys(dataWrap))
          }
        } catch (_) {}
        const teachersRaw = pickFirstArray(
          data?.teachers,
          data?.teacherList,
          data?.users,
          data?.userList,
          data?.rows,
          data?.list,
          dataWrap?.teachers,
          dataWrap?.teacherList,
          dataWrap?.users,
          dataWrap?.userList,
          dataWrap?.rows,
          dataWrap?.list,
        )

        const mine = buildMine(data)

        if (!teachersRaw.length) {
          try {
            console.info('[boss] no teacher list fields found; fallback current user')
          } catch (_) {}
          const me = getUserProfileInfo()
          const myOpenid = getCurrentUserOpenid()
          resolve({
            success: true,
            mine,
            teachers: [
              {
                profile: { nickName: me?.nickName || '当前老师', avatarUrl: me?.avatarUrl || '' },
                ownerKey: myOpenid || undefined,
                backupAt: String(data?.backupAt || '').trim() || undefined,
                courses: mine.courses,
                students: mine.students,
                settings: mine.settings,
                studioExpenses: mine.studioExpenses,
              },
            ],
          })
          return
        }

        const teachersNormalized = asArray(teachersRaw).map((t) => normalizeTeacher(t))
        const uniqueMap = new Map<string, BossTeacherItem>()
        teachersNormalized.forEach((t, idx) => {
          const keyBase = `${t.ownerKey || ''}__${t.profile.nickName || ''}__${t.profile.avatarUrl || ''}`
          const key = keyBase === '__' ? `${keyBase}__${idx}` : keyBase
          if (!uniqueMap.has(key)) uniqueMap.set(key, t)
        })
        const teachers = Array.from(uniqueMap.values())
        const toMs = (v?: string) => {
          const ms = Date.parse(v || '')
          return Number.isFinite(ms) ? ms : 0
        }
        const cmpPinyin = (a: string, b: string) =>
          a.localeCompare(b, 'zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' }) ||
          a.localeCompare(b, 'zh-CN', { sensitivity: 'base' })
        teachers.sort((a, b) => {
          const dt = toMs(b.backupAt) - toMs(a.backupAt)
          if (dt) return dt
          return cmpPinyin(a.profile.nickName || '', b.profile.nickName || '')
        })
        try {
          console.info('[boss] parsed teachers count:', teachers.length)
        } catch (_) {}

          resolve({ success: true, mine, teachers })
        },
        fail: () => resolve({ success: false, teachers: [] }),
      })
    })
  })()
}

/** 跨设备同步：读取老板上次查看的老师 openid */
export function fetchBossLastViewOwnerKeyFromCloud(): Promise<string> {
  return (async () => {
    const token = getValidAuthToken()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) return ''
    return new Promise<string>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/user/boss-view`,
        method: 'GET',
        timeout: 10000,
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          const data = (res.data || {}) as { success?: boolean; bossLastViewOwnerKey?: string }
          if (!data.success) {
            resolve('')
            return
          }
          resolve(String(data.bossLastViewOwnerKey || '').trim())
        },
        fail: () => resolve(''),
      })
    })
  })()
}

/** 跨设备同步：写入老板上次查看的老师 openid（查看他人时也会调用，不依赖完整备份） */
export function saveBossLastViewOwnerKeyToCloud(ownerKey: string): Promise<boolean> {
  return (async () => {
    const token = getValidAuthToken()
    const baseUrl = getBackupServerBase()
    if (!token || !baseUrl) return false
    return new Promise<boolean>((resolve) => {
      wx.request({
        url: `${baseUrl}/api/user/boss-view`,
        method: 'POST',
        timeout: 10000,
        header: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { bossLastViewOwnerKey: ownerKey },
        success: (res) => {
          const data = (res.data || {}) as { success?: boolean }
          resolve(!!data.success)
        },
        fail: () => resolve(false),
      })
    })
  })()
}

