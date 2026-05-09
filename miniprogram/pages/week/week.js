/**
 * 周视图：按时间段展示一周课程
 * UTF-8（由 week.ts 编译生成，若使用 tsc 可删除本文件）
 */
const { getCourses } = require('../../utils/storage')
const { timeToMinutes, minutesToTime } = require('../../utils/schedule')
const { getBossReadOnlyHint, isBossUser, isBossViewingSelf } = require('../../utils/boss')
const { hardRequireProfileSetup } = require('../../utils/profileEnforce')
const { getBossViewingTeacherInfo } = require('../../utils/storage')
const {
  ensureBossViewingTeacherFallback,
  openBossTeacherSwitch,
  refreshBossViewingTeacherFromCloud,
} = require('../../utils/bossSwitch')
const { drainPendingCloudBackup } = require('../../utils/cloud')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    weekStart: '',
    weekRangeText: '',
    weekDays: [],
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
    if (hardRequireProfileSetup && hardRequireProfileSetup()) return
    this.setData({ isBoss: isBossUser() })
    this.syncBossViewInfo()
    this.buildWeekDays()
    if (isBossUser() && !isBossViewingSelf()) {
      if (refreshBossViewingTeacherFromCloud) {
        refreshBossViewingTeacherFromCloud().then((changed) => {
          if (changed) {
            this.syncBossViewInfo()
            this.buildWeekDays()
          }
        })
      }
    } else if (drainPendingCloudBackup) {
      drainPendingCloudBackup()
    }
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh()
    if (isBossUser() && !isBossViewingSelf() && refreshBossViewingTeacherFromCloud) {
      refreshBossViewingTeacherFromCloud(true).then((changed) => {
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
    if (drainPendingCloudBackup) {
      drainPendingCloudBackup().finally(done)
    } else {
      done()
    }
  },

  syncBossViewInfo() {
    if (!isBossUser()) {
      this.setData({ bossViewingLine: '', bossViewingHint: '' })
      return
    }
    ensureBossViewingTeacherFallback()
    const info = getBossViewingTeacherInfo()
    const nick = (info && info.nickName) || '当前老师'
    const id = info && info.ownerKey ? String(info.ownerKey).slice(0, 8) : '未提供'
    this.setData({
      bossViewingLine: '正在查看：' + nick,
      bossViewingHint: 'ID：' + id + '（点击可切换老师）',
      bossViewModeText: isBossViewingSelf() ? '本人可编辑' : '🔒 只读',
      bossViewModeClass: isBossViewingSelf() ? 'boss-badge--edit' : 'boss-badge--readonly',
    })
  },

  async onBossSwitchTeacher() {
    if (!isBossUser()) return
    if (openBossTeacherSwitch) {
      await openBossTeacherSwitch(() => {
        this.syncBossViewInfo()
        this.buildWeekDays()
      })
    }
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

  dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },

  updateWeekRangeText(startStr) {
    const parts = startStr.split('-').map(Number)
    const y = parts[0]
    const m = parts[1]
    const d = parts[2]
    const start = new Date(y, m - 1, d)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const t = m + '月' + d + '日 - ' + (end.getMonth() + 1) + '月' + end.getDate() + '日'
    this.setData({ weekRangeText: t })
  },

  buildWeekDays() {
    const weekStart = this.data.weekStart
    if (!weekStart) return
    const parts = weekStart.split('-').map(Number)
    const y = parts[0]
    const m = parts[1]
    const d = parts[2]
    const all = getCourses()
    const today = this.dateStr(new Date())
    const weekDays = []

    for (let i = 0; i < 7; i++) {
      const date = new Date(y, m - 1, d + i)
      const dateStr = this.dateStr(date)
      const dateShort = (date.getMonth() + 1) + '/' + date.getDate()
      const courses = all
        .filter(function (c) { return c.date === dateStr })
        .sort(function (a, b) { return a.startTime.localeCompare(b.startTime) })
        .map(function (c) {
          return Object.assign({}, c, {
            endTime: minutesToTime(timeToMinutes(c.startTime) + c.duration),
          })
        })
      weekDays.push({
        date: dateStr,
        dateShort: dateShort,
        weekday: '周' + WEEKDAYS[date.getDay()],
        isToday: dateStr === today,
        courses: courses,
      })
    }
    this.setData({ weekDays: weekDays })
  },

  prevWeek() {
    const parts = this.data.weekStart.split('-').map(Number)
    const y = parts[0]
    const m = parts[1]
    const d = parts[2]
    const start = new Date(y, m - 1, d - 7)
    const startStr = this.dateStr(start)
    this.setData({ weekStart: startStr })
    this.updateWeekRangeText(startStr)
    this.buildWeekDays()
  },

  nextWeek() {
    const parts = this.data.weekStart.split('-').map(Number)
    const y = parts[0]
    const m = parts[1]
    const d = parts[2]
    const start = new Date(y, m - 1, d + 7)
    const startStr = this.dateStr(start)
    this.setData({ weekStart: startStr })
    this.updateWeekRangeText(startStr)
    this.buildWeekDays()
  },

  onCourseTap(e) {
    const id = e.currentTarget.dataset.id
    const date = e.currentTarget.dataset.date
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/course-edit/course-edit?id=' + id + '&date=' + date })
  },

  goMonth() {
    wx.navigateBack({ delta: 1 })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },
})
