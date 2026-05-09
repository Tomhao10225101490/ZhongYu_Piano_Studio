/**
 * 老板口令认证
 */

import {
  getBossStatus,
  getCourses,
  getCurrentUserOpenid,
  getSettings,
  getStudents,
  getUserProfileInfo,
  setBossStatus,
  setBossViewingTeacherInfo,
  setBossViewIsSelf,
  setCourses,
  setSettings,
  setStudents,
  setStudioExpenses,
} from '../../../utils/storage'
import {
  backupCurrentUserToCloud,
  fetchLatestBackupFromCloud,
  saveBossLastViewOwnerKeyToCloud,
} from '../../../utils/cloud'
import { canSyncToBackupServer, getValidAuthToken } from '../../../utils/auth'
import { playTouchSound } from '../../../utils/sound'
import { restorePersistedBossTeacherView } from '../../../utils/bossSwitch'
import type { AppSettings, StudioExpense } from '../../../types/index'

const BOSS_AUTH_SECRET = 'zhongjian'

Page({
  data: {
    isBoss: false,
    code: '',
  },

  onLoad() {
    this.syncState()
  },

  onShow() {
    this.syncState()
  },

  /**
   * 从 settings 同步老板认证状态到页面。
   * 说明：bossStatus 属于本地缓存镜像，真实标记以 settings.bossCertified 为准。
   */
  syncState() {
    const s = getSettings()
    if (s.bossCertified === true) {
      setBossStatus(true)
    } else {
      setBossStatus(false)
    }
    this.setData({ isBoss: getBossStatus() })
  },

  onCodeInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ code: (e.detail.value as string) || '' })
  },

  /**
   * 提交老板口令认证。
   * 成功后会：
   * 1) 写入 bossCertified
   * 2) 触发一次上云备份（若可同步）
   * 3) 恢复老板上次查看对象
   */
  onSubmit() {
    playTouchSound()
    if (this.data.isBoss) {
      wx.navigateBack()
      return
    }
    const token = getValidAuthToken()
    if (!token) {
      wx.showToast({ title: '请先在个人页登录账号', icon: 'none' })
      return
    }
    const code = String(this.data.code || '').trim().toLowerCase()
    if (code !== BOSS_AUTH_SECRET) {
      wx.showToast({ title: '口令错误', icon: 'none' })
      return
    }
    setBossStatus(true)
    setSettings({
      ...getSettings(),
      bossCertified: true,
    })
    this.setData({ isBoss: true, code: '' })
    if (canSyncToBackupServer()) void backupCurrentUserToCloud()
    void restorePersistedBossTeacherView()
    wx.showToast({ title: '认证成功', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  },

  onBack() {
    playTouchSound()
    wx.navigateBack()
  },

  onExitBossAuth() {
    playTouchSound()
    wx.showModal({
      title: '退出老板认证',
      content:
        '确定要退出吗？退出后与普通老师账号一致，不再拥有老板查看权限；需要时可重新输入口令认证。',
      confirmText: '退出认证',
      confirmColor: '#ff3b30',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        void this.performExitBossAuth()
      },
    })
  },

  /**
   * 退出老板认证主流程。
   * 设计意图：
   * - 尽量先拉云端本人数据，避免退出时把“代看老师数据”误留在本地。
   * - 最终把 bossCertified 强制置 false，并同步云端以便跨设备一致。
   */
  async performExitBossAuth() {
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      let courses = getCourses()
      let students = getStudents()
      let remoteSettings = getSettings()
      let remoteStudioExpenses: StudioExpense[] | undefined

      const token = getValidAuthToken()
      if (token && canSyncToBackupServer()) {
        const data = await fetchLatestBackupFromCloud()
        if (data && data.success) {
          if (Array.isArray(data.courses)) courses = data.courses
          if (Array.isArray(data.students)) students = data.students
          if (data.settings && typeof data.settings === 'object') {
            remoteSettings = data.settings
          }
          remoteStudioExpenses = Array.isArray(data.studioExpenses) ? data.studioExpenses : []
        }
      }

      setBossStatus(false)
      setBossViewIsSelf(true)

      const { bossLastViewOwnerKey: _drop, ...settingsRest } = remoteSettings as AppSettings & {
        bossLastViewOwnerKey?: string
      }
      const mergedSettings: AppSettings = { ...settingsRest, bossCertified: false }

      setCourses(courses)
      setStudents(students)
      setSettings(mergedSettings)
      if (remoteStudioExpenses !== undefined) {
        setStudioExpenses(remoteStudioExpenses)
      }

      const p = getUserProfileInfo()
      const oid = getCurrentUserOpenid()
      setBossViewingTeacherInfo({
        nickName: (p?.nickName || '当前老师').trim() || '当前老师',
        ownerKey: oid || undefined,
        avatarUrl: p?.avatarUrl || undefined,
      })

      let cloudOk = true
      if (canSyncToBackupServer()) {
        await saveBossLastViewOwnerKeyToCloud('')
        cloudOk = await backupCurrentUserToCloud()
      }

      this.setData({ isBoss: false })
      if (canSyncToBackupServer() && !cloudOk) {
        wx.showModal({
          title: '云端未同步成功',
          content: '本地已退出老板认证，但上传到服务器失败，换设备登录可能仍显示老板。请稍后在网络良好时打开「个人」页再试一次同步备份。',
          showCancel: false,
          confirmText: '知道了',
        })
      } else {
        wx.showToast({ title: '已退出老板认证', icon: 'success' })
      }
    } catch {
      wx.showToast({ title: '处理失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
})
