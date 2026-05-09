import {
  fetchBossLastViewOwnerKeyFromCloud,
  fetchBossTeachersFromCloud,
  saveBossLastViewOwnerKeyToCloud,
} from './cloud'
import type { BossLatestMineBundle, BossTeacherItem } from './cloud'
import { getValidAuthToken } from './auth'
import { isBossUser, isBossViewingSelf } from './boss'
import {
  getBossViewingTeacherInfo,
  getCurrentUserOpenid,
  getSettings,
  getUserProfileInfo,
  setBossViewIsSelf,
  setBossViewingTeacherInfo,
  setCourses,
  setSettings,
  setStudents,
  setStudioExpenses,
} from './storage'

/**
 * 判定老师条目是否等同“当前登录本人”。
 * 优先 ownerKey(openid) 判定；若缺失则回退到昵称+头像弱匹配。
 */
function isSelfTeacher(t: BossTeacherItem): boolean {
  const myOpenid = getCurrentUserOpenid()
  if (t.ownerKey && myOpenid && t.ownerKey === myOpenid) return true
  const p = getUserProfileInfo()
  const nick = (t.profile?.nickName || '').trim()
  const avatar = (t.profile?.avatarUrl || '').trim()
  return !!p && p.nickName === nick && p.avatarUrl === avatar
}

/**
 * 持久化“老板上次查看对象”到本地与云端。
 * 云端写入失败不阻断本地状态，以保证界面流畅。
 */
function persistBossLastViewOwnerKey(ownerKey: string): void {
  const key = (ownerKey || '').trim()
  const cur = getSettings()
  setSettings({ ...cur, bossLastViewOwnerKey: key || undefined })
  void saveBossLastViewOwnerKeyToCloud(key)
}

/** 用云端「本人」备份覆盖本地课表，并标记为查看自己 */
export function applyBossMineBundle(mine: BossLatestMineBundle): void {
  const myOpenid = getCurrentUserOpenid()
  const p = getUserProfileInfo()
  setBossViewIsSelf(true)
  setBossViewingTeacherInfo({
    nickName: (p?.nickName || '当前老师').trim() || '当前老师',
    ownerKey: myOpenid || undefined,
    avatarUrl: p?.avatarUrl || undefined,
  })
  setCourses(Array.isArray(mine.courses) ? mine.courses : [])
  setStudents(Array.isArray(mine.students) ? mine.students : [])
  setStudioExpenses(Array.isArray(mine.studioExpenses) ? mine.studioExpenses : [])
  const prev = getSettings()
  const incoming = mine.settings && typeof mine.settings === 'object' ? mine.settings : {}
  setSettings({
    ...incoming,
    bossCertified: prev.bossCertified === true ? true : incoming.bossCertified,
    backupServerUrl: prev.backupServerUrl || incoming.backupServerUrl,
    bossLastViewOwnerKey: myOpenid || undefined,
  })
  persistBossLastViewOwnerKey(myOpenid || '')
}

/**
 * 把目标老师快照覆盖到本地工作区（课程/学生/设置/支出）。
 * 关键语义：
 * - isSelf=false 时进入“代看他人”态；
 * - 仍保留老板身份与备份地址等跨页面关键配置。
 */
export function applyBossTeacherView(t: BossTeacherItem): { isSelf: boolean } {
  const isSelf = isSelfTeacher(t)
  const myOpenid = getCurrentUserOpenid()
  const keyToSave =
    (t.ownerKey && String(t.ownerKey).trim()) ||
    (isSelf && myOpenid ? myOpenid : '') ||
    myOpenid ||
    ''

  const prevSettings = getSettings()
  setBossViewIsSelf(isSelf)
  setBossViewingTeacherInfo({
    nickName: (t.profile?.nickName || '老师').trim() || '老师',
    ownerKey: t.ownerKey,
    avatarUrl: t.profile?.avatarUrl,
  })
  setCourses(Array.isArray(t.courses) ? t.courses : [])
  setStudents(Array.isArray(t.students) ? t.students : [])
  setStudioExpenses(Array.isArray(t.studioExpenses) ? t.studioExpenses : [])
  const incoming =
    t.settings && typeof t.settings === 'object' ? (t.settings as Record<string, unknown>) : {}
  setSettings({ ...incoming } as any)
  const after = getSettings()
  if (isBossUser()) {
    setSettings({
      ...after,
      bossCertified: prevSettings.bossCertified === true ? true : after.bossCertified,
      backupServerUrl: prevSettings.backupServerUrl || after.backupServerUrl,
      bossLastViewOwnerKey: keyToSave || undefined,
    })
  } else {
    setSettings({
      ...after,
      bossLastViewOwnerKey: keyToSave || undefined,
    })
  }
  persistBossLastViewOwnerKey(keyToSave)
  return { isSelf }
}

/**
 * 老板查看「他人」时，静默从云端重新拉取当前老师最新备份并覆盖本地。
 * 适合在主要数据页 onShow 时调用，避免老师最新数据在本地缓存中陈旧。
 * - 带 8s 节流 + 单飞保护，防止多页 onShow 同时触发多次请求；
 * - force=true 绕过节流（供「下拉刷新」/「刷新」按钮用）；
 * - 返回 true 表示本次确实拉到了该老师并覆盖了本地。
 */
let lastBossRefreshAt = 0
let bossRefreshInFlight: Promise<boolean> | null = null
const BOSS_REFRESH_MIN_INTERVAL_MS = 8000

export function refreshBossViewingTeacherFromCloud(force = false): Promise<boolean> {
  if (!isBossUser()) return Promise.resolve(false)
  if (isBossViewingSelf()) return Promise.resolve(false)
  const target = getBossViewingTeacherInfo()
  const key = String(target?.ownerKey || '').trim()
  if (!key) return Promise.resolve(false)
  if (!getValidAuthToken()) return Promise.resolve(false)

  if (bossRefreshInFlight) return bossRefreshInFlight
  const now = Date.now()
  if (!force && now - lastBossRefreshAt < BOSS_REFRESH_MIN_INTERVAL_MS) {
    return Promise.resolve(false)
  }
  lastBossRefreshAt = now

  const p = (async () => {
    try {
      const res = await fetchBossTeachersFromCloud()
      if (!res.success) return false
      const t = res.teachers.find((x) => (x.ownerKey || '').trim() === key)
      if (!t) return false
      applyBossTeacherView(t)
      return true
    } catch {
      return false
    }
  })()
  bossRefreshInFlight = p
  p.finally(() => {
    if (bossRefreshInFlight === p) bossRefreshInFlight = null
  })
  return p
}

/**
 * 兜底初始化查看对象。
 * 当本地缺少 teacherInfo 时，用“当前老师”占位，防止 UI 空状态。
 */
export function ensureBossViewingTeacherFallback(): void {
  const ex = getBossViewingTeacherInfo()
  if (ex?.nickName) return
  const p = getUserProfileInfo()
  const myOpenid = getCurrentUserOpenid()
  setBossViewingTeacherInfo({
    nickName: p?.nickName || '当前老师',
    ownerKey: myOpenid || undefined,
    avatarUrl: p?.avatarUrl || undefined,
  })
}

export async function openBossTeacherSwitch(onApplied?: (teacher: BossTeacherItem) => void): Promise<void> {
  const res = await fetchBossTeachersFromCloud()
  const list = Array.isArray(res.teachers) ? res.teachers : []
  if (!list.length) {
    wx.showToast({ title: '暂无可切换老师', icon: 'none' })
    return
  }
  // iOS/微信对 actionSheet 项数有限制；老师较多时引导到完整列表页切换
  if (list.length > 6) {
    wx.navigateTo({ url: '/pages/boss/boss-teachers/boss-teachers' })
    wx.showToast({ title: '老师较多，请在列表页切换', icon: 'none' })
    return
  }
  const items = list.map((t) => {
    const nick = (t.profile?.nickName || '老师').trim() || '老师'
    const id = (t.ownerKey || '').trim()
    return id ? `${nick} (${id.slice(0, 8)})` : nick
  })
  wx.showActionSheet({
    itemList: items,
    success: (sheetRes) => {
      const idx = Number(sheetRes.tapIndex)
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return
      const target = list[idx]
      applyBossTeacherView(target)
      if (onApplied) onApplied(target)
      wx.showToast({ title: `正在查看：${target.profile.nickName || '老师'}`, icon: 'none' })
    },
    fail: () => {
      wx.navigateTo({ url: '/pages/boss/boss-teachers/boss-teachers' })
      wx.showToast({ title: '切换面板打开失败，已进入老师列表', icon: 'none' })
    },
  })
}

/**
 * 老板登录或冷启动后：根据云端/本地记录的 bossLastViewOwnerKey 恢复上次查看的老师数据。
 */
/**
 * 冷启动恢复老板上次查看对象。
 * 优先级：云端记忆 > 本地 settings 记忆；目标失效时回退到本人。
 */
export async function restorePersistedBossTeacherView(): Promise<void> {
  if (!isBossUser() || !getValidAuthToken()) return
  try {
    const remoteKey = (await fetchBossLastViewOwnerKeyFromCloud()).trim()
    const localKey = (getSettings().bossLastViewOwnerKey || '').trim()
    const targetKey = remoteKey || localKey
    const myOpenid = (getCurrentUserOpenid() || '').trim()

    const bundle = await fetchBossTeachersFromCloud()
    if (!bundle.success) return

    const applySelf = () => {
      const selfT = bundle.teachers.find((t) => t.ownerKey && String(t.ownerKey).trim() === myOpenid)
      if (selfT) applyBossTeacherView(selfT)
      else if (bundle.mine) applyBossMineBundle(bundle.mine)
    }

    if (!targetKey || !myOpenid || targetKey === myOpenid) {
      applySelf()
      return
    }

    const other = bundle.teachers.find((t) => (t.ownerKey || '').trim() === targetKey)
    if (other) applyBossTeacherView(other)
    else applySelf()
  } catch {
    // ignore
  }
}

