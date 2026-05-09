/**
 * 某日排课页：时间片列表；编辑/取消/复制；长按选课后点另一门课互换时间
 * UTF-8
 */

import { getCoursesByDate, setCourses, getCourses, nextId } from '../../utils/storage'
import {
  timeToMinutes,
  minutesToTime,
  isCourseFinished,
  canSwapCourseTimeSlots,
  swapCourseTimeSlots,
} from '../../utils/schedule'
import { playTouchSound } from '../../utils/sound'
import { backupCurrentUserToCloud, drainPendingCloudBackup } from '../../utils/cloud'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'
import type { Course } from '../../types/index'
import { hardRequireProfileSetup } from '../../utils/profileEnforce'
import { refreshBossViewingTeacherFromCloud } from '../../utils/bossSwitch'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

Page({
  data: {
    date: '',
    dateDisplay: '',
    weekdayText: '',
    courses: [] as (Course & { endTime: string; isFinished: boolean })[],
    isBoss: false,
    showCancelModal: false,
    cancelTargetId: '' as string,
    cancelModalTitle: '',
    cancelModalContent: '',
    cancelTargetFinished: false,
    /** 长按选中的待互换课程 id，空表示未进入选点模式 */
    swapSourceId: '',
    showSwapModal: false,
    swapModalTitle: '',
    swapModalContent: '',
    swapShowCancel: true,
    swapConfirmText: '确定',
    swapPairSourceId: '',
    swapPairTargetId: '',
  },

  onLoad(opt: { date?: string }) {
    const date = opt?.date || this.todayStr()
    const [y, m, d] = date.split('-').map(Number)
    const dObj = new Date(y, m - 1, d)
    const weekdayText = WEEKDAYS[dObj.getDay()]
    this.setData({
      date,
      dateDisplay: `${m}月${d}日`,
      weekdayText,
    })
    this.loadDay()
  },

  onShow() {
    this.setData({ isBoss: isBossUser() })
    if (hardRequireProfileSetup()) return
    this.loadDay()
    if (isBossUser() && !isBossViewingSelf()) {
      void refreshBossViewingTeacherFromCloud().then((changed) => {
        if (changed) this.loadDay()
      })
    } else {
      void drainPendingCloudBackup()
    }
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    if (isBossUser() && !isBossViewingSelf()) {
      void refreshBossViewingTeacherFromCloud(true).then((changed) => {
        if (changed) {
          this.loadDay()
          wx.showToast({ title: '已刷新最新数据', icon: 'success' })
        } else {
          wx.showToast({ title: '暂未发现新数据', icon: 'none' })
        }
        done()
      })
      return
    }
    void drainPendingCloudBackup().finally(done)
  },

  todayStr(): string {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  },

  loadDay() {
    const { date } = this.data
    const list = getCoursesByDate(date).map((c) => ({
      ...c,
      endTime: minutesToTime(timeToMinutes(c.startTime) + c.duration),
      isFinished: isCourseFinished(c.date, c.startTime, c.duration),
    }))
    this.setData({ courses: list })
  },

  /** 退出「待互换」选中态 */
  clearSwapPick() {
    if (!this.data.swapSourceId) return
    this.setData({ swapSourceId: '' })
  },

  onHide() {
    this.clearSwapPick()
  },

  onUnload() {
    this.clearSwapPick()
  },

  onAdd() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const sourceId = this.data.swapSourceId
    if (sourceId) {
      const src = this.data.courses.find((c) => c.id === sourceId)
      const endTime = src?.endTime
      this.clearSwapPick()
      wx.navigateTo({
        // 不对 HH:mm 做 encode，避免 course-edit 校验正则失败后退回 suggestNextStart()
        url: `/pages/course-edit/course-edit?date=${this.data.date}&startTime=${endTime || ''}`,
      })
      return
    }
    this.clearSwapPick()
    wx.navigateTo({
      url: `/pages/course-edit/course-edit?date=${this.data.date}`,
    })
  },

  /**
   * 点击课程卡片主体（复制/取消为 catchtap，不会触发本事件）
   * 未选中：进编辑；已选中：点自己取消，点另一门发起互换确认
   */
  onCourseCardTap(e: WechatMiniprogram.TouchEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const sourceId = this.data.swapSourceId

    if (sourceId) {
      playTouchSound()
      if (id === sourceId) {
        this.clearSwapPick()
        wx.showToast({ title: '已取消选择', icon: 'none', duration: 1400 })
        return
      }
      this.tryOpenSwapModal(sourceId, id)
      return
    }

    playTouchSound()
    wx.navigateTo({
      url: `/pages/course-edit/course-edit?id=${id}&date=${this.data.date}`,
    })
  },

  /** 长按进入/切换/取消「待互换」选中 */
  onCardLongPress(e: WechatMiniprogram.TouchEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const cur = this.data.swapSourceId
    playTouchSound()
    if (cur === id) {
      this.clearSwapPick()
      wx.showToast({ title: '已取消选择', icon: 'none', duration: 1400 })
      return
    }
    this.setData({ swapSourceId: id })
  },

  onCopy(e: WechatMiniprogram.TouchEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    this.clearSwapPick()
    playTouchSound()
    const id = e.currentTarget.dataset.id
    const all = getCourses()
    const src = all.find((c) => c.id === id)
    if (!src) return
    const dayCourses = getCoursesByDate(this.data.date)
    const last = dayCourses[dayCourses.length - 1]
    const newStart = last
      ? minutesToTime(timeToMinutes(last.startTime) + last.duration)
      : src.startTime
    const newId = nextId()
    const copy: Course = { ...src, id: newId, startTime: newStart }
    const list = [...all, copy]
    setCourses(list)
    wx.showToast({ title: '已复制', icon: 'success' })
    this.loadDay()
  },

  onCancel(e: WechatMiniprogram.TouchEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    this.clearSwapPick()
    playTouchSound()
    const id = e.currentTarget.dataset.id as string
    const course = this.data.courses.find((c) => c.id === id)
    const finished = course?.isFinished ?? false
    this.setData({
      showCancelModal: true,
      cancelTargetId: id,
      cancelModalTitle: finished ? '删除课程' : '取消课程',
      cancelModalContent: finished
        ? '该课程已结束，是否确定删除？'
        : '该课程还没结束，是否确定取消？',
      cancelTargetFinished: finished,
    })
  },

  onConfirmCancel() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    playTouchSound()
    const id = this.data.cancelTargetId
    const finished = this.data.cancelTargetFinished
    this.setData({
      showCancelModal: false,
      cancelTargetId: '',
      cancelModalTitle: '',
      cancelModalContent: '',
      cancelTargetFinished: false,
    })
    if (!id) return
    const doRemove = () => {
      const all = getCourses().filter((c) => c.id !== id)
      setCourses(all)
      void backupCurrentUserToCloud()
      wx.showToast({ title: finished ? '已删除' : '已取消', icon: 'success' })
      this.loadDay()
    }
    if (finished) {
      wx.showModal({
        title: '再次确认删除',
        content: '这节课已经上过了，删除会影响历史记录。真的要删除吗？',
        confirmText: '仍要删除',
        confirmColor: '#FF3B30',
        success: (res) => {
          if (!res.confirm) return
          doRemove()
        },
      })
      return
    }
    doRemove()
  },

  onCancelModal() {
    playTouchSound()
    this.setData({
      showCancelModal: false,
      cancelTargetId: '',
      cancelModalTitle: '',
      cancelModalContent: '',
      cancelTargetFinished: false,
    })
  },

  formatCourseSwapLine(c: Course): string {
    const end = minutesToTime(timeToMinutes(c.startTime) + c.duration)
    return `「${c.studentName}」\n${c.startTime} - ${end}（${c.duration}分钟）`
  },

  tryOpenSwapModal(sourceId: string, targetId: string) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const all = getCourses()
    const source = all.find((c) => c.id === sourceId)
    const target = all.find((c) => c.id === targetId)
    if (!source || !target) return

    if (source.duration !== target.duration) {
      this.setData({
        showSwapModal: true,
        swapModalTitle: '无法调换',
        swapModalContent: '两门课时长不一致，仅支持相同时长的课程互换上课时间。',
        swapShowCancel: false,
        swapConfirmText: '知道了',
        swapPairSourceId: '',
        swapPairTargetId: '',
      })
      return
    }

    if (!canSwapCourseTimeSlots(sourceId, targetId)) {
      this.setData({
        showSwapModal: true,
        swapModalTitle: '无法调换',
        swapModalContent: '调换后与当日其他课程时间冲突，请调整后再试。',
        swapShowCancel: false,
        swapConfirmText: '知道了',
        swapPairSourceId: '',
        swapPairTargetId: '',
      })
      return
    }

    const line1 = this.formatCourseSwapLine(source)
    const line2 = this.formatCourseSwapLine(target)
    this.setData({
      showSwapModal: true,
      swapModalTitle: '确认调换',
      swapModalContent: `是否将以下两门课对调？\n\n${line1}\n\n${line2}`,
      swapShowCancel: true,
      swapConfirmText: '确定',
      swapPairSourceId: sourceId,
      swapPairTargetId: targetId,
    })
  },

  closeSwapModal() {
    this.setData({
      showSwapModal: false,
      swapModalTitle: '',
      swapModalContent: '',
      swapShowCancel: true,
      swapConfirmText: '确定',
      swapPairSourceId: '',
      swapPairTargetId: '',
    })
  },

  onSwapModalConfirm() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    playTouchSound()
    const s = this.data.swapPairSourceId
    const t = this.data.swapPairTargetId
    const hadPair = !!(s && t)
    this.closeSwapModal()
    if (!hadPair) return
    const ok = swapCourseTimeSlots(s, t)
    if (ok) {
      this.clearSwapPick()
      void backupCurrentUserToCloud()
      wx.showToast({ title: '已调换', icon: 'success' })
      this.loadDay()
    } else {
      wx.showToast({ title: '调换失败', icon: 'none' })
    }
  },

  onSwapModalCancel() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    playTouchSound()
    this.closeSwapModal()
  },
})
