/**
 * 偏好设置：单价、默认时长、提醒、音效、页面背景图等
 * UTF-8
 */

import { getBossStatus, getSettings, setBossStatus, setSettings } from '../../utils/storage'
import { backupCurrentUserToCloud } from '../../utils/cloud'
import { canSyncToBackupServer, getValidAuthToken } from '../../utils/auth'
import { getBackupServerBase } from '../../utils/server'
import { playTouchSound } from '../../utils/sound'
import type { AppSettings } from '../../types/index'
import { isBossUser, isBossViewingSelf } from '../../utils/boss'
const DURATIONS = [30, 45, 60, 90]
const REMINDER_OPTIONS = [0, 15, 30]
const REMINDER_LABELS = ['不提醒', '提前15分钟', '提前30分钟']

Page({
  data: {
    pricePerClass: '' as string | number,
    /** 老板上交比例（0-100），教师所得 = 100 - 该比例 */
    bossSharePercent: '0' as string | number,
    durationIndex: 1,
    durationOptions: DURATIONS,
    reminderIndex: 0,
    reminderLabels: REMINDER_LABELS,
    soundEnabled: true,
    hasBackground: false,
    bgPreview: '',

    isBoss: false,
  },

  onLoad() {
    this.syncFromStorage()
  },

  onShow() {
    this.syncFromStorage()
  },

  syncFromStorage() {
    const s = getSettings()
    // 与 settings 一致：云端/本地已退出老板时须清除老板标记
    if (s.bossCertified === true) {
      setBossStatus(true)
    } else {
      setBossStatus(false)
    }
    const di = Math.max(0, DURATIONS.indexOf(s.defaultDuration ?? 45))
    const ri = Math.max(0, REMINDER_OPTIONS.indexOf(s.defaultReminderMinutes ?? 0))
    const url = (s.backgroundImageUrl || '').trim()
    const local = (s.backgroundImageLocalPath || '').trim()
    const preview = url || local
    this.setData({
      pricePerClass: (s.pricePerClass ?? '') === '' ? '' : String(s.pricePerClass),
      bossSharePercent:
        typeof s.bossSharePercent === 'number' && Number.isFinite(s.bossSharePercent)
          ? String(s.bossSharePercent)
          : '0',
      durationIndex: di,
      reminderIndex: ri,
      soundEnabled: s.soundEnabled !== false,
      hasBackground: !!(url || local),
      bgPreview: preview,

      isBoss: getBossStatus(),
    })
  },

  onPriceInput(e: WechatMiniprogram.CustomEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const v = (e.detail.value as string).replace(/\D/g, '')
    this.setData({ pricePerClass: v })
  },

  onBossSharePercentInput(e: WechatMiniprogram.CustomEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const v = (e.detail.value as string).replace(/[^\d]/g, '')
    this.setData({ bossSharePercent: v })
  },

  onDurationChange(e: WechatMiniprogram.PickerChange) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const i = Number(e.detail.value)
    this.setData({ durationIndex: i })
  },

  onReminderChange(e: WechatMiniprogram.PickerChange) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const i = Number(e.detail.value)
    this.setData({ reminderIndex: i })
  },

  onSoundChange(e: WechatMiniprogram.SwitchChange) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const enabled = e.detail.value
    this.setData({ soundEnabled: enabled })
  },

  /** 将临时文件持久化到本机并作为背景（云端 URL 清空） */
  applyLocalBackground(tempPath: string, toastTitle: string) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    wx.getFileSystemManager().saveFile({
      tempFilePath: tempPath,
      success: (s) => {
        setSettings({
          ...getSettings(),
          backgroundImageLocalPath: s.savedFilePath,
          backgroundImageUrl: undefined,
        })
        this.setData({ hasBackground: true, bgPreview: s.savedFilePath })
        const comp = this.selectComponent('#appBgComp')
        if (comp && typeof (comp as { refresh?: () => void }).refresh === 'function') {
          ;(comp as { refresh: () => void }).refresh()
        }
        wx.showToast({ title: toastTitle, icon: 'none', duration: 3200 })
      },
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
    })
  },

  onChooseBackground() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = res.tempFiles[0]?.tempFilePath
        if (!temp) return
        const token = getValidAuthToken()
        const base = getBackupServerBase()
        if (token && base) {
          wx.getFileSystemManager().readFile({
            filePath: temp,
            encoding: 'base64',
            success: (readRes) => {
              const raw = (readRes.data as string) || ''
              if (!raw) {
                wx.showToast({ title: '读取图片失败', icon: 'none' })
                return
              }
              const lower = temp.toLowerCase()
              const mime = lower.endsWith('.png')
                ? 'png'
                : lower.endsWith('.webp')
                  ? 'webp'
                  : lower.endsWith('.gif')
                    ? 'gif'
                    : 'jpeg'
              const imageBase64 = `data:image/${mime};base64,${raw}`
              wx.showLoading({ title: '上传中…' })
              wx.request({
                url: `${base}/api/user/background/upload`,
                method: 'POST',
                timeout: 60000,
                header: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                data: { imageBase64 },
                success: (resp) => {
                  wx.hideLoading()
                  const httpCode = resp.statusCode || 0
                  // 线上未部署 /api/user/background/upload 时多为 404，先保证本机可用
                  if (httpCode === 404 || httpCode === 405 || httpCode === 501) {
                    this.applyLocalBackground(
                      temp,
                      '服务端暂无背景上传接口，已保存到本机。请部署最新 server 后再试上传。',
                    )
                    return
                  }
                  if (httpCode < 200 || httpCode >= 300) {
                    wx.showToast({ title: `上传失败（${httpCode}）`, icon: 'none' })
                    return
                  }
                  const data = (resp.data || {}) as { success?: boolean; imageUrl?: string; message?: string }
                  if (!data.success || !data.imageUrl) {
                    wx.showToast({ title: data.message || '上传失败', icon: 'none' })
                    return
                  }
                  setSettings({
                    ...getSettings(),
                    backgroundImageUrl: data.imageUrl,
                    backgroundImageLocalPath: undefined,
                  })
                  this.setData({ hasBackground: true, bgPreview: data.imageUrl })
                  const comp = this.selectComponent('#appBgComp')
                  if (comp && typeof (comp as { refresh?: () => void }).refresh === 'function') {
                    ;(comp as { refresh: () => void }).refresh()
                  }
                  if (canSyncToBackupServer()) void backupCurrentUserToCloud()
                  wx.showToast({ title: '背景已更新', icon: 'success' })
                },
                fail: () => {
                  wx.hideLoading()
                  wx.showToast({ title: '网络错误', icon: 'none' })
                },
              })
            },
            fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
          })
          return
        }
        this.applyLocalBackground(temp, '已保存到本机（未登录时不同步云端）')
      },
    })
  },

  onClearBackground() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    setSettings({
      ...getSettings(),
      backgroundImageUrl: undefined,
      backgroundImageLocalPath: undefined,
    })
    this.setData({ hasBackground: false, bgPreview: '' })
    const comp = this.selectComponent('#appBgComp')
    if (comp && typeof (comp as { refresh?: () => void }).refresh === 'function') {
      ;(comp as { refresh: () => void }).refresh()
    }
    if (canSyncToBackupServer()) void backupCurrentUserToCloud()
    wx.showToast({ title: '已恢复默认背景', icon: 'success' })
  },

  onOpenStudents() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/students/students' })
  },

  onOpenBossCert() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/boss/boss-cert/boss-cert' })
  },

  onOpenBossTeachers() {
    playTouchSound()
    if (!isBossUser()) {
      wx.showToast({ title: '请先完成老板认证', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/boss/boss-teachers/boss-teachers' })
  },

  async onConfirmSave() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: '老板模式仅查看，不能修改数据', icon: 'none' })
      return
    }
    const rawBoss = Number(this.data.bossSharePercent)
    const bossSharePercent = Number.isFinite(rawBoss)
      ? Math.min(100, Math.max(0, Math.floor(rawBoss)))
      : 0
    const settings: AppSettings = {
      ...getSettings(),
      pricePerClass: this.data.pricePerClass === '' ? undefined : Number(this.data.pricePerClass),
      bossSharePercent,
      defaultDuration: DURATIONS[this.data.durationIndex],
      defaultReminderMinutes: REMINDER_OPTIONS[this.data.reminderIndex],
      soundEnabled: !!this.data.soundEnabled,
    }
    setSettings(settings)

    const canCloud = canSyncToBackupServer()
    wx.showLoading({ title: canCloud ? '保存并备份中…' : '保存中…' })
    try {
      const backedUp = canCloud ? await backupCurrentUserToCloud() : false
      wx.hideLoading()
      if (backedUp) {
        wx.showToast({ title: '设置已保存并已备份', icon: 'success' })
      } else if (canCloud) {
        wx.showToast({ title: '设置已保存（云备份未完成）', icon: 'none' })
      } else {
        wx.showToast({ title: '设置已保存', icon: 'success' })
      }
    } catch {
      wx.hideLoading()
      wx.showToast({
        title: canCloud ? '设置已保存（云备份失败）' : '设置已保存',
        icon: 'none',
      })
    }
  },
})
