/**
 * 钟于钢琴工作室 - 排课小程序
 * 纯前端，数据存本地 wx.setStorageSync / wx.getStorageSync
 * UTF-8
 */

import { getCourses } from './utils/storage'
import { canSyncToBackupServer, getValidAuthToken } from './utils/auth'
import { backupCurrentUserToCloud, drainPendingCloudBackup } from './utils/cloud'
import { restorePersistedBossTeacherView } from './utils/bossSwitch'
import { getBossStatus, getSettings, getUserProfileInfo, setBossStatus, setUserProfileInfo } from './utils/storage'
import { getBackupServerBase } from './utils/server'

let lastAutoBackupAt = 0
const AUTO_BACKUP_MIN_INTERVAL_MS = 3 * 60 * 1000
const KEY_ENCOURAGE_SHOWN_DATE = 'piano_encourage_shown_date'
const KEY_FORCE_PROFILE_LAST_SHOWN_AT = 'piano_force_profile_last_shown_at'
const FORCE_PROFILE_COOLDOWN_MS = 3 * 60 * 1000
let isForceProfileChecking = false
/** 每个冷启动只自动恢复一次老板查看对象，避免每次 onShow 覆盖本地未备份修改 */
let didRestoreBossViewThisColdStart = false

const ENCOURAGE_QUOTES = [
  '辛苦啦，愿你被温柔包围。',
  '累了就歇一歇，你超棒的。',
  '今天也辛苦你啦。',
  '再忙也要照顾好自己。',
  '你值得所有美好与温柔。',
  '辛苦啦，记得放松一下。',
  '你的付出，都有意义。',
  '今天也辛苦，也很棒。',
  '愿所有疲惫都被治愈。',
  '辛苦啦，愿你常被温暖。',
  '累了就停一下，没关系。',
  '今天也要好好爱自己。',
  '辛苦了，一切都值得。',
]

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getCurrentRoute(): string {
  try {
    const pages = (getCurrentPages as unknown as () => any[])?.() || []
    const top = pages[pages.length - 1]
    return String(top?.route || top?.__route__ || '')
  } catch {
    return ''
  }
}

function isOnSettingsPage(): boolean {
  const route = getCurrentRoute()
  if (!route) return false
  if (route === 'settings') return true
  if (route === 'pages/settings/settings') return true
  // 容错：有时路由只会保留末段
  return route.includes('settings')
}

function maybeForceProfileSetup(): boolean {
  try {
    const token = getValidAuthToken()
    if (!token) return false // 未登录/游客
    if (getUserProfileInfo()) return false // 已有昵称+头像

    const now = Date.now()
    const lastShownAt = Number(wx.getStorageSync(KEY_FORCE_PROFILE_LAST_SHOWN_AT) || 0)
    if (isForceProfileChecking) return true
    if (lastShownAt > 0 && now - lastShownAt < FORCE_PROFILE_COOLDOWN_MS) return true

    const serverBase = getBackupServerBase()
    if (!serverBase) return false

    isForceProfileChecking = true
    wx.showLoading({ title: '校验资料…' })
    wx.request({
      url: serverBase + '/api/user/profile',
      method: 'GET',
      timeout: 10000,
      header: { Authorization: 'Bearer ' + token },
      success: (resp) => {
        const data = (resp.data || {}) as { success?: boolean; profile?: { nickName?: string; avatarUrl?: string; updatedAt?: string } | null }
        const profile = data?.profile
        const nickName = (profile?.nickName || '').trim()
        const avatarUrl = (profile?.avatarUrl || '').trim()
        const has = !!nickName && !!avatarUrl && nickName !== '微信用户' && nickName !== '未设置昵称'
        if (!has) {
          wx.showModal({
            title: '请先设置头像和昵称',
            content: '为保证你能正常使用，请先在“个人”页面设置头像与昵称。',
            showCancel: false,
            confirmText: '去设置',
            success: () => {
              wx.setStorageSync(KEY_FORCE_PROFILE_LAST_SHOWN_AT, Date.now())
              if (!isOnSettingsPage()) {
                wx.reLaunch({ url: '/pages/settings/settings' })
              }
            },
          })
          return
        }

        // 服务器已有资料：补齐本地缓存，避免后续主页面误判拦截
        setUserProfileInfo({
          nickName,
          avatarUrl,
          gender: profile?.gender,
          country: profile?.country,
          province: profile?.province,
          city: profile?.city,
          language: profile?.language,
          updatedAt: profile?.updatedAt || new Date().toISOString(),
        })
      },
      fail: () => {
        // 网络失败时也给出“去设置”的强提醒，避免用户卡在无法使用的状态
        wx.showModal({
          title: '请先设置头像和昵称',
          content: '当前无法校验你的资料。为了继续使用，请前往“个人”页面设置头像与昵称。',
          showCancel: false,
          confirmText: '去设置',
          success: () => {
            wx.setStorageSync(KEY_FORCE_PROFILE_LAST_SHOWN_AT, Date.now())
            if (!isOnSettingsPage()) {
              wx.reLaunch({ url: '/pages/settings/settings' })
            }
          },
        })
      },
      complete: () => {
        wx.hideLoading()
        isForceProfileChecking = false
      },
    })
    return true
  } catch {
    return false
  }
}

/** 与本地 settings.bossCertified 对齐老板标记（退出后 false 须能覆盖本地 KEY_BOSS_STATUS） */
function syncBossStatusFromSettings(): void {
  try {
    if (!getValidAuthToken()) return
    const s = getSettings()
    if (s.bossCertified === true) {
      setBossStatus(true)
    } else {
      setBossStatus(false)
    }
  } catch {
    // ignore
  }
}

/** 每天 21:00 后首次打开时弹一次暖心提醒 */
function maybeShowEncourageModalOncePerNight(): void {
  try {
    const now = new Date()
    if (now.getHours() < 21) return
    const today = formatDateYMD(now)
    const shownDate = String(wx.getStorageSync(KEY_ENCOURAGE_SHOWN_DATE) || '')
    if (shownDate === today) return
    const quote = ENCOURAGE_QUOTES[randomInt(0, ENCOURAGE_QUOTES.length - 1)]
    wx.showModal({
      title: '辛苦啦',
      content: quote,
      showCancel: false,
      confirmText: '收到',
    })
    wx.setStorageSync(KEY_ENCOURAGE_SHOWN_DATE, today)
  } catch (_) {
    // ignore
  }
}

App<IAppOption>({
  globalData: {},
  onLaunch() {
    didRestoreBossViewThisColdStart = false
  },
  onShow() {
    // 先尝试从云端已恢复的 settings 同步老板身份
    syncBossStatusFromSettings()

    // 资料强制校验：登录后若未设置头像+昵称，则强制引导到个人页设置
    const shouldBlock = maybeForceProfileSetup()
    if (shouldBlock) return

    if (getBossStatus() && getValidAuthToken() && !didRestoreBossViewThisColdStart) {
      didRestoreBossViewThisColdStart = true
      void restorePersistedBossTeacherView()
    }

    // 若上次退出/切后台时自动备份失败过，这里尝试补同步一次，
    // 避免"老师以为已同步，但云端没有、老板看不到"的情况。
    void drainPendingCloudBackup()

    // 上课提醒：下次打开时若有待上课程在提醒时间内则弹窗
    let didShowReminder = false
    const triggerEncourage = () => {
      setTimeout(() => maybeShowEncourageModalOncePerNight(), 350)
    }
    try {
      const now = new Date()
      const today = formatDateYMD(now)
      const min = now.getHours() * 60 + now.getMinutes()
      const courses = getCourses().filter((c) => c.date === today && (c.reminderMinutes ?? 0) > 0)
      for (const c of courses) {
        const [h, m] = c.startTime.split(':').map(Number)
        const startMin = h * 60 + m
        const reminder = c.reminderMinutes ?? 0
        if (min >= startMin - reminder && min < startMin) {
          didShowReminder = true
          wx.showModal({
            title: '上课提醒',
            content: `${c.studentName} ${c.startTime} 有课，请准备。`,
            showCancel: false,
            complete: () => {
              // 先完成上课提醒，再尝试暖心弹窗
              triggerEncourage()
            },
          })
          break
        }
      }
    } catch (_) {}

    // 暖心提示：21:00 后每天仅一次；若无上课提醒则直接尝试
    if (!didShowReminder) {
      triggerEncourage()
    }
  },
  onHide() {
    // 已登录用户切后台时静默备份；游客仅本机存储，不向服务器上传
    if (!canSyncToBackupServer()) return
    const now = Date.now()
    if (now - lastAutoBackupAt < AUTO_BACKUP_MIN_INTERVAL_MS) return
    lastAutoBackupAt = now
    void backupCurrentUserToCloud()
  },
})
