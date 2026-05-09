import { fetchBossTeachersFromCloud } from '../../../utils/cloud'
import { getBossReadOnlyHint, isBossUser } from '../../../utils/boss'
import { getCurrentUserOpenid, getSettings, getUserProfileInfo, setBossViewIsSelf } from '../../../utils/storage'
import type { BossTeacherItem } from '../../../utils/cloud'
import { applyBossTeacherView, ensureBossViewingTeacherFallback } from '../../../utils/bossSwitch'

Page({
  data: {
    loading: false,
    teachers: [] as BossTeacherItem[],
    activeIndex: -1,
  },

  onLoad() {
    if (!isBossUser()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadTeachers()
  },

  /**
   * 拉取并展示老师列表。
   * 排序规则：最近备份时间优先，其次昵称拼音顺序。
   * 默认选中规则：上次查看对象 > 本人 > 不选中。
   */
  async loadTeachers() {
    this.setData({ loading: true })
    const res = await fetchBossTeachersFromCloud()
    if (!res.success) {
      this.setData({ loading: false, teachers: [], activeIndex: -1 })
      wx.showToast({ title: '老师列表拉取失败，请到个人页重新登录', icon: 'none', duration: 2600 })
      return
    }
    const teachers = Array.isArray(res.teachers) ? res.teachers.slice() : []
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
    const myOpenid = getCurrentUserOpenid()
    const myProfile = getUserProfileInfo()
    const selfIdx = teachers.findIndex((t) => {
      if (t.ownerKey && myOpenid && t.ownerKey === myOpenid) return true
      const nick = (t.profile?.nickName || '').trim()
      const avatar = (t.profile?.avatarUrl || '').trim()
      return myProfile?.nickName === nick && myProfile?.avatarUrl === avatar
    })

    const pref = (getSettings().bossLastViewOwnerKey || '').trim()
    let preferredIdx = -1
    if (pref && myOpenid && pref !== myOpenid) {
      preferredIdx = teachers.findIndex((t) => (t.ownerKey || '').trim() === pref)
    }
    if (preferredIdx < 0 && myOpenid) {
      preferredIdx = teachers.findIndex((t) => t.ownerKey && t.ownerKey === myOpenid)
    }
    const activeIndex = preferredIdx >= 0 ? preferredIdx : selfIdx >= 0 ? selfIdx : -1
    this.setData({ teachers, loading: false, activeIndex })

    if (activeIndex >= 0) {
      applyBossTeacherView(teachers[activeIndex])
    } else {
      setBossViewIsSelf(true)
      ensureBossViewingTeacherFallback()
    }
  },

  /**
   * 选择某位老师并切换本地工作区。
   * 只负责“切换视图”，不在此处做写云动作。
   */
  onSelectTeacher(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.idx)
    if (!Number.isFinite(idx)) {
      wx.showToast({ title: '未识别到老师序号，请重试', icon: 'none' })
      return
    }
    const t = this.data.teachers[idx]
    if (!t) {
      wx.showToast({ title: '老师数据不存在，请刷新后重试', icon: 'none' })
      return
    }

    const myOpenid = getCurrentUserOpenid()
    const myProfile = getUserProfileInfo()
    const isSelf =
      (t.ownerKey && myOpenid && t.ownerKey === myOpenid) ||
      (myProfile?.nickName === (t.profile?.nickName || '').trim() && myProfile?.avatarUrl === (t.profile?.avatarUrl || '').trim())
    applyBossTeacherView(t)
    this.setData({ activeIndex: idx })
    wx.showToast({ title: isSelf ? `切回本人：${t.profile.nickName}` : `正在查看：${t.profile.nickName}`, icon: 'none' })
  },

  viewTeacher() {
    const idx = this.data.activeIndex
    if (!Number.isFinite(idx) || idx < 0) {
      wx.showToast({ title: '请先选择老师', icon: 'none' })
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  },
})

