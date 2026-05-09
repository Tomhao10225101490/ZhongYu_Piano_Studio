import { getValidAuthToken } from './auth'
import { getUserProfileInfo } from './storage'

const KEY_FORCE_PROFILE_LAST_SHOWN_AT = 'piano_force_profile_last_shown_at'
const FORCE_PROFILE_COOLDOWN_MS = 3 * 60 * 1000

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
  return route === 'settings' || route === 'pages/settings/settings' || route.includes('settings')
}

/**
 * 强制校验：登录后如果没有设置头像/昵称，则拦截进入并引导到“个人(设置)”页。
 * 返回 true 表示调用方需要 return（避免继续执行 onShow 逻辑）。
 */
export function hardRequireProfileSetup(redirectUrl = '/pages/settings/settings'): boolean {
  try {
    if (isOnSettingsPage()) return false

    const token = getValidAuthToken()
    if (!token) return false // 未登录/游客模式不强制

    const p = getUserProfileInfo()
    if (p) return false

    const now = Date.now()
    const lastShownAt = Number(wx.getStorageSync(KEY_FORCE_PROFILE_LAST_SHOWN_AT) || 0)
    if (lastShownAt > 0 && now - lastShownAt < FORCE_PROFILE_COOLDOWN_MS) return true

    wx.showModal({
      title: '请先设置头像和昵称',
      content: '为保证你能正常使用，请先在“个人”页面设置头像与昵称。',
      showCancel: false,
      confirmText: '去设置',
      success: () => {
        wx.setStorageSync(KEY_FORCE_PROFILE_LAST_SHOWN_AT, Date.now())
        wx.reLaunch({ url: redirectUrl })
      },
    })
    return true
  } catch {
    return false
  }
}

