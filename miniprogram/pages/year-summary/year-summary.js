/**
 * 年度汇总独立页（与 year-summary.ts 逻辑一致）
 */
const {
  getBossViewingTeacherInfo,
  getCourses,
  getStudents,
  getSettings,
  getStudioExpenses,
} = require('../../utils/storage')
const { getTodayStr } = require('../../utils/dateRange')
const { computeYearSummaryDisplay } = require('../../utils/yearSummaryCompute')
const { playTouchSound } = require('../../utils/sound')
const { hardRequireProfileSetup } = require('../../utils/profileEnforce')
const { isBossUser, isBossViewingSelf } = require('../../utils/boss')
const {
  ensureBossViewingTeacherFallback,
  openBossTeacherSwitch,
  refreshBossViewingTeacherFromCloud,
} = require('../../utils/bossSwitch')
const { drainPendingCloudBackup } = require('../../utils/cloud')

Page({
  data: {
    isBoss: false,
    bossViewingLine: '',
    bossViewingHint: '',
    bossViewModeText: '',
    bossViewModeClass: '',

    summaryYear: new Date().getFullYear(),
    summaryYearPickerValue: '',
    yearStatCount: 0,
    yearTotalFee: '0.00',
    yearBossFee: '0.00',
    yearTeacherFee: '0.00',
    yearStudioExpense: '0.00',
    yearNetRevenue: '0.00',
    yearNetBoss: '0.00',
    showShareModal: false,
  },

  onLoad() {
    const today = getTodayStr()
    const y = Number(today.slice(0, 4)) || new Date().getFullYear()
    this.setData({
      summaryYear: y,
      summaryYearPickerValue: `${y}-01-01`,
    })
    this.refresh()
  },

  onShow() {
    if (hardRequireProfileSetup()) return
    this.setData({ isBoss: isBossUser() })
    this.syncBossViewInfo()
    this.refresh()
    if (isBossUser() && !isBossViewingSelf()) {
      if (refreshBossViewingTeacherFromCloud) {
        refreshBossViewingTeacherFromCloud().then((changed) => {
          if (changed) {
            this.syncBossViewInfo()
            this.refresh()
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
          this.refresh()
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
      this.refresh()
    })
  },

  refresh() {
    const courses = getCourses()
    const students = getStudents()
    const settings = getSettings()
    const summaryYear = Number(this.data.summaryYear) || new Date().getFullYear()
    const yearDisp = computeYearSummaryDisplay(
      summaryYear,
      courses,
      students,
      settings,
      getStudioExpenses(),
    )
    this.setData({
      summaryYear: yearDisp.summaryYear,
      summaryYearPickerValue: yearDisp.summaryYearPickerValue,
      yearStatCount: yearDisp.yearStatCount,
      yearTotalFee: yearDisp.yearTotalFee,
      yearBossFee: yearDisp.yearBossFee,
      yearTeacherFee: yearDisp.yearTeacherFee,
      yearStudioExpense: yearDisp.yearStudioExpense,
      yearNetRevenue: yearDisp.yearNetRevenue,
      yearNetBoss: yearDisp.yearNetBoss,
    })
  },

  onSummaryYearPick(e) {
    playTouchSound()
    const v = String(e.detail.value || '')
    const y = Number(v.slice(0, 4))
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return
    this.setData({ summaryYear: y, summaryYearPickerValue: `${y}-01-01` })
    this.refresh()
  },

  goStudioExpenses() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/studio-expenses/studio-expenses' })
  },

  onOpenShareModal() {
    playTouchSound()
    this.setData({ showShareModal: true })
  },

  onCloseShareModal() {
    playTouchSound()
    this.setData({ showShareModal: false })
  },

  noop() {},

  onCopyYearSummaryText() {
    playTouchSound()
    const y = Number(this.data.summaryYear) || new Date().getFullYear()
    const text =
      `${y}年度汇总\n` +
      `上课节数：${this.data.yearStatCount} 节\n` +
      `课时费合计：¥ ${this.data.yearTotalFee}\n` +
      `老板所得：¥ ${this.data.yearBossFee}\n` +
      `教师所得：¥ ${this.data.yearTeacherFee}\n` +
      `工作室支出：¥ ${this.data.yearStudioExpense}\n` +
      `全年结余：¥ ${this.data.yearNetRevenue}\n` +
      `老板净得：¥ ${this.data.yearNetBoss}\n` +
      `说明：教师所得为实得分成，不扣工作室固定支出。`
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制年度汇总', icon: 'success' })
  },

  onShareYearSummaryImage() {
    playTouchSound()
    this.setData({ showShareModal: false })
    const y = Number(this.data.summaryYear) || new Date().getFullYear()
    const q = [
      `type=year-summary`,
      `year=${encodeURIComponent(String(y))}`,
      `classes=${encodeURIComponent(String(this.data.yearStatCount))}`,
      `total=${encodeURIComponent(String(this.data.yearTotalFee))}`,
      `boss=${encodeURIComponent(String(this.data.yearBossFee))}`,
      `teacher=${encodeURIComponent(String(this.data.yearTeacherFee))}`,
      `expense=${encodeURIComponent(String(this.data.yearStudioExpense))}`,
      `net=${encodeURIComponent(String(this.data.yearNetRevenue))}`,
      `bossNet=${encodeURIComponent(String(this.data.yearNetBoss))}`,
    ].join('&')
    wx.navigateTo({ url: `/pages/schedule-image/schedule-image?${q}` })
  },
})
