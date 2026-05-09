/**
 * 周视图：按时间段展示一周课程
 * UTF-8
 */

import { getBossViewingTeacherInfo, getCourses } from '../../utils/storage'
import { timeToMinutes, minutesToTime } from '../../utils/schedule'
import { playTouchSound } from '../../utils/sound'
import { getTodayStr } from '../../utils/dateRange'
import type { Course } from '../../types/index'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'
import { hardRequireProfileSetup } from '../../utils/profileEnforce'
import {
  ensureBossViewingTeacherFallback,
  openBossTeacherSwitch,
  refreshBossViewingTeacherFromCloud,
} from '../../utils/bossSwitch'
import { drainPendingCloudBackup } from '../../utils/cloud'

interface DayInfo {
  date: string
  dateShort: string
  weekday: string
  isToday: boolean
  courses: (Course & { endTime: string })[]
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    weekStart: '', // YYYY-MM-DD
    weekRangeText: '',
    weekDays: [] as DayInfo[],
    showShareModal: false,
    shareText: '',
    isBoss: false,
    bossViewingLine: '',
    bossViewingHint: '',
    bossViewModeText: '',
    bossViewModeClass: '',
  },

  onLoad() {
    this.initWeek()
  },

  onShow() {
    if (hardRequireProfileSetup()) return
    this.setData({ isBoss: isBossUser() })
    this.syncBossViewInfo()
    this.buildWeekDays()
    if (isBossUser() && !isBossViewingSelf()) {
      void refreshBossViewingTeacherFromCloud().then((changed) => {
        if (changed) {
          this.syncBossViewInfo()
          this.buildWeekDays()
        }
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
          this.syncBossViewInfo()
          this.buildWeekDays()
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

  syncBossViewInfo() {
    if (!isBossUser()) {
      this.setData({ bossViewingLine: '', bossViewingHint: '' })
      return
    }
    ensureBossViewingTeacherFallback()
    const info = getBossViewingTeacherInfo()
    const nick = info?.nickName || '当前老师'
    const id = info?.ownerKey ? info.ownerKey.slice(0, 8) : '未提供'
    this.setData({
      bossViewingLine: `正在查看：${nick}`,
      bossViewingHint: `ID：${id}（点击可切换老师）`,
      bossViewModeText: isBossViewingSelf() ? '本人可编辑' : '🔒 只读',
      bossViewModeClass: isBossViewingSelf() ? 'boss-badge--edit' : 'boss-badge--readonly',
    })
  },

  async onBossSwitchTeacher() {
    if (!isBossUser()) return
    playTouchSound()
    await openBossTeacherSwitch(() => {
      this.syncBossViewInfo()
      this.buildWeekDays()
    })
  },

  initWeek() {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day
    const start = new Date(now)
    start.setDate(diff)
    const startStr = this.dateStr(start)
    this.setData({ weekStart: startStr })
    this.updateWeekRangeText(startStr)
    this.buildWeekDays()
  },

  dateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  updateWeekRangeText(startStr: string) {
    const [y, m, d] = startStr.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const t = `${m}月${d}日 - ${end.getMonth() + 1}月${end.getDate()}日`
    this.setData({ weekRangeText: t })
  },

  buildWeekDays() {
    const { weekStart } = this.data
    if (!weekStart) return
    const [y, m, d] = weekStart.split('-').map(Number)
    const all = getCourses()
    const today = this.dateStr(new Date())
    const weekDays: DayInfo[] = []

    for (let i = 0; i < 7; i++) {
      const date = new Date(y, m - 1, d + i)
      const dateStr = this.dateStr(date)
      const dateShort = `${date.getMonth() + 1}/${date.getDate()}`
      const courses = all
        .filter((c) => c.date === dateStr)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((c) => ({
          ...c,
          endTime: minutesToTime(timeToMinutes(c.startTime) + c.duration),
        }))
      weekDays.push({
        date: dateStr,
        dateShort,
        weekday: '周' + WEEKDAYS[date.getDay()],
        isToday: dateStr === today,
        courses,
      })
    }
    this.setData({ weekDays })
  },

  prevWeek() {
    playTouchSound()
    const [y, m, d] = this.data.weekStart.split('-').map(Number)
    const start = new Date(y, m - 1, d - 7)
    const startStr = this.dateStr(start)
    this.setData({ weekStart: startStr })
    this.updateWeekRangeText(startStr)
    this.buildWeekDays()
  },

  nextWeek() {
    playTouchSound()
    const [y, m, d] = this.data.weekStart.split('-').map(Number)
    const start = new Date(y, m - 1, d + 7)
    const startStr = this.dateStr(start)
    this.setData({ weekStart: startStr })
    this.updateWeekRangeText(startStr)
    this.buildWeekDays()
  },

  onCourseTap(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const { id, date } = e.currentTarget.dataset
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/course-edit/course-edit?id=${id}&date=${date}` })
  },

  onDayTap(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const date = (e.currentTarget.dataset.date as string) || ''
    if (!date) return
    wx.navigateTo({ url: `/pages/day/day?date=${date}` })
  },

  goMonth() {
    playTouchSound()
    wx.navigateBack({ delta: 1 })
  },

  goStats() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  goSettings() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  onOpenShareModal() {
    playTouchSound()
    this.setData({
      showShareModal: true,
      shareText: this.buildWeekShareText(),
    })
  },

  onCloseShareModal() {
    playTouchSound()
    this.setData({ showShareModal: false })
  },

  buildWeekShareText(): string {
    const lines: string[] = []
    this.data.weekDays.forEach((day) => {
      day.courses.forEach((c) => {
        lines.push(`${c.date} ${c.startTime}-${c.endTime} ${c.duration}分钟 ${c.studentName}`)
      })
    })
    if (!lines.length) return `${this.data.weekRangeText} 暂无课程`
    return `${this.data.weekRangeText} 课表\n` + lines.join('\n')
  },

  onCopyShareText() {
    playTouchSound()
    const text = (this.data.shareText as string) || this.buildWeekShareText()
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制分享文本', icon: 'success' })
  },

  onShareWeekImage() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/schedule-image/schedule-image?type=week' })
  },

  onShareTodayImage() {
    playTouchSound()
    const date = getTodayStr()
    wx.navigateTo({ url: `/pages/schedule-image/schedule-image?type=day&date=${date}` })
  },

  onShareDayPick(e: WechatMiniprogram.PickerChange) {
    playTouchSound()
    const date = e.detail.value as string
    if (date) wx.navigateTo({ url: `/pages/schedule-image/schedule-image?type=day&date=${date}` })
  },

  noop() {},
})
