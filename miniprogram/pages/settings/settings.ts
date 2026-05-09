/**
 * 个人页入口：头像昵称、账号状态、跳转到设置/备份/关于
 * UTF-8
 */

import {
  clearAuthState,
  getAuthState,
  getSettings,
  getCurrentUserOpenid,
  getBossStatus,
  getUserProfileInfo,
  setBossStatus,
  setCourses,
  setSettings,
  setStudents,
  setStudioExpenses,
  setUserProfileInfo,
} from '../../utils/storage'
import { playTouchSound } from '../../utils/sound'
import { getValidAuthToken, loginWithServer } from '../../utils/auth'
import { BACKUP_SERVER_URL, getBackupServerBase } from '../../utils/server'
import { backupCurrentUserToCloud, fetchLatestBackupFromCloud } from '../../utils/cloud'
import { restorePersistedBossTeacherView } from '../../utils/bossSwitch'
import type { UserProfileInfo } from '../../types/index'

interface ProfileResponse {
  success?: boolean
  message?: string
  profile?: UserProfileInfo | null
}

interface AvatarUploadResponse {
  success?: boolean
  message?: string
  avatarUrl?: string
}

/**
 * 刷新登录前强制用户选择同步基准。
 * 设计意图：避免“登录后自动拉云端”误覆盖本机最新排课数据。
 */
function askLoginSyncConflictChoice(): Promise<'upload_local' | 'restore_cloud'> {
  return new Promise((resolve) => {
    // 使用 ActionSheet：在微信环境里比 showModal 更不容易被遮罩层/时序吞掉
    wx.showActionSheet({
      itemList: ['以上传本地为准（保护本机最新数据）', '以云端恢复为准（覆盖本机）'],
      success: (res) => resolve(res.tapIndex === 0 ? 'upload_local' : 'restore_cloud'),
      fail: () => {
        wx.showToast({ title: '未选择同步方式，已默认保留本机数据', icon: 'none', duration: 2600 })
        resolve('upload_local')
      },
    })
  })
}

Page({
  data: {
    backupServerUrl: BACKUP_SERVER_URL,
    isLoggedIn: false,
    userOpenid: '',
    userScopeLabel: '游客模式（本机数据）',
    profileNickName: '',
    profileAvatarUrl: '',
    profileHint: '未获取微信昵称头像',
    profileIdText: 'ID：游客模式',
    editingNickName: '未设置昵称',
    editingAvatarUrl: '',
    isBoss: false,
    showNickModal: false,
    nickDraft: '',
    showAccountDetailModal: false,
    accountDetailUpdatedAtText: '未设置',
    accountDetailBossText: '未通过老板认证',
  },

  onLoad() {
    this.setData({ backupServerUrl: BACKUP_SERVER_URL })
    this.setData({ isBoss: getBossStatus() })
    this.syncAuthState()
    this.syncProfileHint()
    this.syncProfileFromServer(false)
  },

  onShow() {
    this.setData({ backupServerUrl: BACKUP_SERVER_URL })
    this.setData({ isBoss: getBossStatus() })
    this.syncAuthState()
    this.syncProfileHint()
    this.syncProfileFromServer(false)
  },

  /**
   * 从服务端拉取昵称/头像并更新本地展示。
   * 兼容处理：若历史头像是 http 且当前服务端为 https，则重写为 https uploads 地址。
   */
  syncProfileFromServer(showFailToast: boolean) {
    const token = getValidAuthToken()
    const url = getBackupServerBase()
    if (!token || !url) return
    wx.request({
      url: url + '/api/user/profile',
      method: 'GET',
      header: { Authorization: 'Bearer ' + token },
      success: (resp) => {
        const data = (resp.data || {}) as ProfileResponse
        if (!data.success) {
          if (showFailToast) wx.showToast({ title: data.message || '同步资料失败', icon: 'none' })
          return
        }
        if (!data.profile) return
        const remote = data.profile
        const serverBase = getBackupServerBase()
        if (remote.avatarUrl && remote.avatarUrl.startsWith('http://') && serverBase.startsWith('https://')) {
          const idx = remote.avatarUrl.indexOf('/uploads/')
          if (idx !== -1) {
            remote.avatarUrl = `${serverBase}${remote.avatarUrl.slice(idx)}`
          }
        }
        if (!remote.nickName || !remote.avatarUrl) return
        setUserProfileInfo(remote)
        this.syncProfileHint()
      },
      fail: () => {
        if (showFailToast) wx.showToast({ title: '网络错误，资料同步失败', icon: 'none' })
      },
    })
  },

  /**
   * 把 storage 中的 authState 映射到页面展示状态。
   * 注意：expiresAt=0 视为永久有效。
   */
  syncAuthState() {
    const state = getAuthState()
    const openid = state?.openid || ''
    const valid = !!state && (state.expiresAt === 0 || Date.now() < state.expiresAt)
    this.setData({
      isLoggedIn: valid,
      userOpenid: openid,
      userScopeLabel: openid ? `已登录用户：${openid}` : '游客模式（本机数据）',
      profileIdText: openid ? `ID：${openid}` : 'ID：游客模式',
    })
  },

  syncProfileHint() {
    const p = getUserProfileInfo()
    if (!p) {
      this.setData({
        profileNickName: '',
        profileAvatarUrl: '',
        profileHint: '未获取微信昵称头像',
        editingNickName: '',
        editingAvatarUrl: '',
        accountDetailUpdatedAtText: '未设置',
      })
      return
    }
    const safeNick = p.nickName === '微信用户' ? '' : p.nickName
    const at = p.updatedAt.replace('T', ' ').slice(0, 19)
    this.setData({
      profileNickName: safeNick,
      profileAvatarUrl: p.avatarUrl,
      profileHint: safeNick ? `资料更新时间：${at}` : `资料更新时间：${at}（昵称需手动设置）`,
      editingNickName: safeNick || '未设置昵称',
      editingAvatarUrl: p.avatarUrl,
      accountDetailUpdatedAtText: at,
    })
  },

  onShowAbout() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/about/about' })
  },

  /**
   * 手动“刷新登录”主流程。
   * 顺序：
   * 1) 先选同步基准（本地为准/云端为准）
   * 2) 完成登录，刷新本页身份与资料
   * 3) 执行对应的数据同步策略
   * 4) 如需恢复老板视图，再恢复跨设备查看对象
   */
  async onLoginForBackup() {
    playTouchSound()
    const serverUrl = getBackupServerBase()
    try {
      // 强制用户先选同步基准，避免“登录后自动恢复”误覆盖本地新数据
      const choice = await askLoginSyncConflictChoice()
      wx.showLoading({ title: '登录中…' })
      const prevOpenid = getCurrentUserOpenid()
      const result = await loginWithServer(serverUrl)
      wx.hideLoading()
      this.syncAuthState()
      this.syncProfileHint()
      this.syncProfileFromServer(false)
      const syncResult = await this.tryAutoRestoreAfterLogin(choice)
      const restored = syncResult === 'restored'
      // 与当前 settings 对齐（无云备份恢复时也要根据本地 settings 清/设老板标记）
      const s = getSettings()
      if (s.bossCertified === true) setBossStatus(true)
      else setBossStatus(false)
      this.setData({ isBoss: getBossStatus() })
      // 若用户刚选择“本地为准”，则跳过老板视图恢复，避免再次拉回云端旧数据
      if (getBossStatus() && syncResult !== 'kept_local') {
        await restorePersistedBossTeacherView()
      }
      wx.showToast({ title: restored ? '登录成功，已自动恢复云数据' : '登录成功', icon: 'success' })
      if (result.openid) {
        // 仅刷新展示，不暴露完整 token
        this.setData({ userOpenid: result.openid })
      }
      if (restored) {
        wx.showModal({
          title: '已自动恢复',
          content: '已自动恢复服务器最新备份，点击确定返回首页刷新。',
          showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/index/index' }),
        })
        return
      }
      if (result.openid && result.openid !== prevOpenid) {
        wx.showModal({
          title: '已切换账号',
          content: '当前展示数据已切换到新账号，点击确定返回首页刷新。',
          showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/index/index' }),
        })
      }
    } catch (err) {
      wx.hideLoading()
      const msg = err instanceof Error ? err.message : '登录失败'
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  /**
   * 登录后同步策略执行器。
   * - upload_local: 保留本机并尝试上传，不下拉覆盖。
   * - restore_cloud: 以云端快照覆盖本地。
   */
  async tryAutoRestoreAfterLogin(choice: 'upload_local' | 'restore_cloud'): Promise<'restored' | 'kept_local' | 'none'> {
    if (choice === 'upload_local') {
      wx.showLoading({ title: '上传本机数据…' })
      const uploaded = await backupCurrentUserToCloud()
      wx.hideLoading()
      if (uploaded) {
        wx.showToast({ title: '已以上传本机数据为准', icon: 'success' })
      } else {
        wx.showToast({ title: '本机数据已保留，上传失败请稍后重试', icon: 'none', duration: 2800 })
      }
      return 'kept_local' // 本地保留并尝试上云，不做云端下拉覆盖
    }

    // 选择「以云端恢复为准」后再拉取并恢复
    const data = await fetchLatestBackupFromCloud()
    if (!data || !data.success) {
      wx.showToast({ title: '云端暂无可恢复备份', icon: 'none' })
      return 'none'
    }

    const courses = Array.isArray(data.courses) ? data.courses : []
    const students = Array.isArray(data.students) ? data.students : []
    const settings = data.settings && typeof data.settings === 'object' ? data.settings : {}
    const hasRemoteSettings = Object.keys(settings).length > 0
    if (courses.length === 0 && students.length === 0 && !hasRemoteSettings) {
      wx.showToast({ title: '云端暂无可恢复备份', icon: 'none' })
      return 'none'
    }

    wx.showLoading({ title: '恢复云端数据…' })
    setCourses(courses)
    setStudents(students)
    setSettings(settings)
    if (Array.isArray(data.studioExpenses)) {
      setStudioExpenses(data.studioExpenses)
    }
    // 与云端 settings 严格一致：已退出老板时须清除本地老板标记，否则下次登入仍显示老板
    if ((settings as Record<string, unknown>).bossCertified === true) {
      setBossStatus(true)
    } else {
      setBossStatus(false)
    }
    wx.hideLoading()
    return 'restored'
  },

  onLogoutForBackup() {
    playTouchSound()
    clearAuthState()
    this.syncAuthState()
    this.syncProfileHint()
    wx.showModal({
      title: '已退出登录',
      content: '当前将切回游客数据视图，点击确定返回首页。',
      showCancel: false,
      success: () => wx.reLaunch({ url: '/pages/index/index' }),
    })
  },

  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    playTouchSound()
    const avatarUrl = (e.detail?.avatarUrl || '').trim()
    if (!avatarUrl) {
      wx.showToast({ title: '请选择头像', icon: 'none' })
      return
    }
    const token = getValidAuthToken()
    const url = getBackupServerBase()
    if (!token) {
      wx.showToast({ title: '请先登录后再选择头像', icon: 'none' })
      return
    }
    this.setData({ profileAvatarUrl: avatarUrl })
    wx.showLoading({ title: '上传头像…' })
    wx.getFileSystemManager().readFile({
      filePath: avatarUrl,
      encoding: 'base64',
      success: (readRes) => {
        const base64 = (readRes.data as string) || ''
        if (!base64) {
          wx.hideLoading()
          wx.showToast({ title: '读取头像失败', icon: 'none' })
          return
        }
        wx.request({
          url: url + '/api/user/avatar/upload',
          method: 'POST',
          header: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          data: { avatarBase64: `data:image/jpeg;base64,${base64}` },
          success: (resp) => {
            wx.hideLoading()
            const data = (resp.data || {}) as AvatarUploadResponse
            if (!data.success || !data.avatarUrl) {
              wx.showToast({ title: data.message || '上传头像失败', icon: 'none' })
              return
            }
            const nickName = ((this.data.editingNickName as string) || '').trim()
            this.setData({
              editingAvatarUrl: data.avatarUrl,
              profileAvatarUrl: data.avatarUrl,
            })
            if (nickName && nickName !== '微信用户' && nickName !== '未设置昵称') {
              this.saveProfileToServer(nickName, data.avatarUrl)
              return
            }
            wx.showToast({ title: '头像已上传，请点击昵称设置', icon: 'success' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误，头像上传失败', icon: 'none' })
          },
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '读取头像失败', icon: 'none' })
      },
    })
  },

  onNickNameInput(e: WechatMiniprogram.CustomEvent) {
    const v = ((e.detail.value as string) || '').trim()
    this.setData({ editingNickName: v || '未设置昵称' })
  },

  onOpenNickModal() {
    playTouchSound()
    const current = (this.data.editingNickName as string) || ''
    const init = current && current !== '未设置昵称' ? current : ''
    this.setData({ showNickModal: true, nickDraft: init })
  },

  onNickDraftInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ nickDraft: (e.detail.value as string) || '' })
  },

  noop() {},

  onCloseNickModal() {
    playTouchSound()
    this.setData({ showNickModal: false })
  },

  onConfirmNickModal() {
    playTouchSound()
    const nickName = ((this.data.nickDraft as string) || '').trim()
    const avatarUrl = ((this.data.editingAvatarUrl as string) || '').trim()
    if (!nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    if (nickName === '微信用户') {
      wx.showToast({ title: '请修改为你自己的昵称', icon: 'none' })
      return
    }
    if (!avatarUrl) {
      wx.showToast({ title: '请先点击头像选择头像', icon: 'none' })
      return
    }
    if (avatarUrl.startsWith('wxfile://')) {
      wx.showToast({ title: '请等待头像上传完成', icon: 'none' })
      return
    }
    this.setData({
      showNickModal: false,
      editingNickName: nickName,
      profileNickName: nickName,
    })
    this.saveProfileToServer(nickName, avatarUrl)
  },

  onOpenPreferences() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/preferences/preferences' })
  },

  onOpenAccountDetail() {
    playTouchSound()
    const isBoss = !!this.data.isBoss
    this.setData({
      showAccountDetailModal: true,
      accountDetailBossText: isBoss ? '已通过老板认证（老板模式）' : '未通过老板认证',
    })
  },

  onCloseAccountDetail() {
    playTouchSound()
    this.setData({ showAccountDetailModal: false })
  },

  onOpenYearSummary() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/year-summary/year-summary' })
  },

  onOpenBackupCenter() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/backup-center/backup-center' })
  },

  goMonth() {
    playTouchSound()
    wx.reLaunch({ url: '/pages/index/index' })
  },

  goWeek() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/week/week' })
  },

  goStats() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  saveProfileToServer(nickName: string, avatarUrl: string) {
    const token = getValidAuthToken()
    const url = getBackupServerBase()
    if (!token) {
      wx.showToast({ title: '请先登录后再保存资料', icon: 'none' })
      return
    }
    const profile: UserProfileInfo = {
      nickName,
      avatarUrl,
      updatedAt: new Date().toISOString(),
    }
    wx.showLoading({ title: '保存中…' })
    wx.request({
      url: url + '/api/user/profile',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      data: profile,
      success: (resp) => {
        wx.hideLoading()
        const data = (resp.data || {}) as ProfileResponse
        if (!data.success) {
          wx.showToast({ title: data.message || '保存失败', icon: 'none' })
          return
        }
        const saved = data.profile || profile
        setUserProfileInfo(saved)
        this.syncProfileHint()
        wx.showToast({ title: '资料已更新', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' })
      },
    })
  },
})
