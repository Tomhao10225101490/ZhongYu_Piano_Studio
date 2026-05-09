/**
 * 微信登录与服务端登录态处理
 */

import { getAuthState, setAuthState } from './storage'

interface LoginResponse {
  code?: number
  success?: boolean
  message?: string
  openid?: string
  token?: string
  authToken?: string
  expiresAt?: number
}

/**
 * 拉取微信临时登录凭证 code。
 * 返回 code 字符串；失败时抛错，交由上层统一 toast。
 */
function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject(new Error('未获取到微信登录 code'))
          return
        }
        resolve(res.code)
      },
      fail: () => reject(new Error('调用 wx.login 失败')),
    })
  })
}

/**
 * 调用服务端登录接口，把 wx code 换成业务 token。
 * 仅负责网络与 HTTP 成功性校验，不做业务字段语义判断。
 */
function requestLogin(serverUrl: string, code: string): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${serverUrl.replace(/\/+$/, '')}/api/wx/login`,
      method: 'POST',
      timeout: 12000,
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`登录接口异常（HTTP ${res.statusCode}）`))
          return
        }
        resolve((res.data || {}) as LoginResponse)
      },
      fail: (err) => {
        const msg = err?.errMsg ? String(err.errMsg) : '登录请求失败'
        reject(new Error(msg))
      },
    })
  })
}

/**
 * 完整登录流程：
 * 1) wx.login 获取 code
 * 2) 调服务端换 token
 * 3) 校验关键字段并落本地 authState
 *
 * 兼容说明：
 * - token / authToken 两种字段都接受（兼容旧后端响应）。
 * - expiresAt 允许为 0（表示永久有效），也允许正整数时间戳。
 */
export async function loginWithServer(serverUrl: string): Promise<{ openid: string; expiresAt: number }> {
  const code = await wxLogin()
  const data = await requestLogin(serverUrl, code)
  const token = data.token || data.authToken
  const success = data.success === true || data.code === 0
  const expiresAt = Number(data.expiresAt)
  if (!success || !data.openid || !token || !Number.isFinite(expiresAt) || expiresAt < 0) {
    throw new Error(data.message || '登录失败')
  }
  setAuthState({
    openid: data.openid,
    authToken: token,
    expiresAt,
  })
  return { openid: data.openid, expiresAt }
}

/**
 * 读取当前可用 token。
 * - 无状态：返回空串
 * - expiresAt > 0 且已过期：返回空串
 * - expiresAt = 0：按永久有效处理
 */
export function getValidAuthToken(): string {
  const state = getAuthState()
  if (!state) return ''
  // expiresAt=0 表示永久有效
  if (state.expiresAt > 0 && Date.now() >= state.expiresAt) return ''
  return state.authToken
}

/**
 * 是否允许向备份服务器同步课程/学生/设置等。
 * 游客模式或未登录、或 token 已过期：始终为 false，不应发起任何备份类请求。
 */
export function canSyncToBackupServer(): boolean {
  return !!getValidAuthToken()
}

