/**
 * 统计页：本日/本周/本月总览小卡片 + 详情区（点击切换周期）
 * UTF-8
 */

import {
  getBossViewingTeacherInfo,
  getCourses,
  getStudents,
  getSettings,
  getStudioExpenses,
} from '../../utils/storage'
import { getWeekRange, getMonthRange, getTodayStr, formatDateShort, formatWeekRange } from '../../utils/dateRange'
import {
  listFeeDetailsInRange,
  buildFeeShareText,
} from '../../utils/feeStats'
import { computeYearSummaryDisplay } from '../../utils/yearSummaryCompute'
import { playTouchSound } from '../../utils/sound'
import type { Course } from '../../types/index'
import { hardRequireProfileSetup } from '../../utils/profileEnforce'
import { isBossUser, isBossViewingSelf } from '../../utils/boss'
import {
  ensureBossViewingTeacherFallback,
  openBossTeacherSwitch,
  refreshBossViewingTeacherFromCloud,
} from '../../utils/bossSwitch'
import { drainPendingCloudBackup } from '../../utils/cloud'

type PeriodKey = 'day' | 'week' | 'month'

type PeriodCard = {
  key: PeriodKey
  title: string
  subtitle: string
  rangeStart: string
  rangeEnd: string
  count: number
  totalFee: string
  bossFee: string
  teacherFee: string
}

type StudentCountItem = {
  name: string
  count: number
  color: string
}

function toDateParts(dateStr: string): { y: number; m: number; d: number } | null {
  const parts = String(dateStr || '').split('-').map(Number)
  if (parts.length !== 3) return null
  const [y, m, d] = parts
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  return { y, m, d }
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function getWeekRangeByDate(dateStr: string): [string, string] {
  const p = toDateParts(dateStr)
  if (!p) return getWeekRange()
  const now = new Date(p.y, p.m - 1, p.d)
  const day = now.getDay()
  const start = new Date(now)
  start.setDate(now.getDate() - day)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return [fmtDate(start.getFullYear(), start.getMonth() + 1, start.getDate()), fmtDate(end.getFullYear(), end.getMonth() + 1, end.getDate())]
}

function getMonthRangeByDate(dateStr: string): [string, string] {
  const p = toDateParts(dateStr)
  if (!p) return getMonthRange()
  const start = fmtDate(p.y, p.m, 1)
  const last = new Date(p.y, p.m, 0)
  const end = fmtDate(p.y, p.m, last.getDate())
  return [start, end]
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const p = toDateParts(dateStr)
  if (!p) return getTodayStr()
  const dt = new Date(p.y, p.m - 1, p.d)
  dt.setDate(dt.getDate() + deltaDays)
  return fmtDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

function shiftMonth(dateStr: string, deltaMonths: number): string {
  const p = toDateParts(dateStr)
  if (!p) return getTodayStr()
  const dt = new Date(p.y, p.m - 1, p.d)
  dt.setMonth(dt.getMonth() + deltaMonths)
  return fmtDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** 明细项：用于列表展示，含日期展示、课时费及展示用字符串 */
export interface StatDetailItem extends Course {
  dateDisplay: string
  fee: number
  feeDisplay: string
  bossSharePercent: number
  teacherSharePercent: number
  sharePercentDisplay: string
  bossFee: number
  bossFeeDisplay: string
  teacherFee: number
  teacherFeeDisplay: string
}

Page({
  data: {
    anchorDate: '',
    anchorDateText: '',
    isTodayAnchor: true,
    quickPrevText: '上一日',
    quickNextText: '下一日',
    activePeriod: 'day' as PeriodKey,
    periodCards: [] as PeriodCard[],

    currentTitle: '本日',
    currentSubtitle: '',
    currentRangeStart: '',
    currentRangeEnd: '',
    currentCount: 0,
    currentFee: '0',
    currentBossFee: '0',
    currentTeacherFee: '0',
    currentDetailList: [] as StatDetailItem[],
    currentStudentCountTitle: '本日学生上课节数',
    currentStudentCountList: [] as StudentCountItem[],

    pricePerClass: 0,
    defaultBossSharePercent: 0,
    defaultTeacherSharePercent: 100,

    dayDetailList: [] as StatDetailItem[],
    weekDetailList: [] as StatDetailItem[],
    monthDetailList: [] as StatDetailItem[],
    dayStudentCountList: [] as StudentCountItem[],
    weekStudentCountList: [] as StudentCountItem[],
    monthStudentCountList: [] as StudentCountItem[],
    showShareModal: false,
    showYearShareModal: false,
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
  },

  onLoad() {
    const today = getTodayStr()
    const y = Number(today.slice(0, 4)) || new Date().getFullYear()
    this.setData({
      anchorDate: today,
      anchorDateText: formatDateShort(today),
      isTodayAnchor: true,
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
      void refreshBossViewingTeacherFromCloud().then((changed) => {
        if (changed) {
          this.syncBossViewInfo()
          this.refresh()
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
          this.refresh()
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
      this.refresh()
    })
  },

  formatDateDisplay(dateStr: string): string {
    const [_, m, d] = dateStr.split('-').map(Number)
    return `${m}月${d}日`
  },

  makeDetailList(rows: ReturnType<typeof listFeeDetailsInRange>['rows']): StatDetailItem[] {
    return rows.map((r) => {
      const c = r.course
      return {
        ...c,
        dateDisplay: this.formatDateDisplay(c.date),
        fee: r.fee,
        feeDisplay: r.fee.toFixed(2),
        bossSharePercent: r.bossSharePercent,
        teacherSharePercent: 100 - r.bossSharePercent,
        sharePercentDisplay: `老板 ${r.bossSharePercent}% · 教师 ${100 - r.bossSharePercent}%`,
        bossFee: r.bossFee,
        bossFeeDisplay: r.bossFee.toFixed(2),
        teacherFee: r.teacherFee,
        teacherFeeDisplay: r.teacherFee.toFixed(2),
      }
    })
  },

  makeStudentCountList(detailList: StatDetailItem[]): StudentCountItem[] {
    const map = new Map<string, StudentCountItem>()
    detailList.forEach((item) => {
      const name = (item.studentName || '').trim()
      if (!name) return
      const ex = map.get(name)
      if (ex) {
        ex.count += 1
      } else {
        map.set(name, {
          name,
          count: 1,
          color: item.studentColor || '#A8C5C0',
        })
      }
    })
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  },

  /**
   * 把“当前激活周期”映射到主展示区。
   * 这里是卡片数据与明细列表的唯一绑定点，避免不同周期 UI 口径分叉。
   */
  applyActivePeriod(period?: PeriodKey) {
    const active = period || (this.data.activePeriod as PeriodKey)
    const cards = this.data.periodCards as PeriodCard[]
    const card = cards.find((c) => c.key === active)
    if (!card) return
    const listMap: Record<PeriodKey, StatDetailItem[]> = {
      day: this.data.dayDetailList,
      week: this.data.weekDetailList,
      month: this.data.monthDetailList,
    }
    const countMap: Record<PeriodKey, StudentCountItem[]> = {
      day: this.data.dayStudentCountList,
      week: this.data.weekStudentCountList,
      month: this.data.monthStudentCountList,
    }
    const titleMap: Record<PeriodKey, string> = {
      day: '本日学生上课节数',
      week: '本周学生上课节数',
      month: '本月学生上课节数',
    }
    const quickTextMap: Record<PeriodKey, { prev: string; next: string }> = {
      day: { prev: '上一日', next: '下一日' },
      week: { prev: '上一周', next: '下一周' },
      month: { prev: '上一月', next: '下一月' },
    }
    this.setData({
      activePeriod: active,
      quickPrevText: quickTextMap[active].prev,
      quickNextText: quickTextMap[active].next,
      currentTitle: card.title,
      currentSubtitle: card.subtitle,
      currentRangeStart: card.rangeStart,
      currentRangeEnd: card.rangeEnd,
      currentCount: card.count,
      currentFee: card.totalFee,
      currentBossFee: card.bossFee,
      currentTeacherFee: card.teacherFee,
      currentDetailList: listMap[active],
      currentStudentCountTitle: titleMap[active],
      currentStudentCountList: countMap[active],
    })
  },

  /**
   * 统计页总刷新入口。
   * 从同一批源数据同步计算：日/周/月卡片、明细、学生节次、年度汇总。
   */
  refresh() {
    const courses = getCourses()
    const students = getStudents()
    const settings = getSettings()
    const globalPrice = Number(settings.pricePerClass ?? 0)
    const today = getTodayStr()
    const anchorDate = this.data.anchorDate || today
    const dayRange: [string, string] = [anchorDate, anchorDate]
    const weekRange = getWeekRangeByDate(anchorDate)
    const monthRange = getMonthRangeByDate(anchorDate)

    const dayStat = listFeeDetailsInRange(dayRange, courses, students, settings)
    const weekStat = listFeeDetailsInRange(weekRange, courses, students, settings)
    const monthStat = listFeeDetailsInRange(monthRange, courses, students, settings)

    const dayDetailList = this.makeDetailList(dayStat.rows)
    const weekDetailList = this.makeDetailList(weekStat.rows)
    const monthDetailList = this.makeDetailList(monthStat.rows)
    const dayStudentCountList = this.makeStudentCountList(dayDetailList)
    const weekStudentCountList = this.makeStudentCountList(weekDetailList)
    const monthStudentCountList = this.makeStudentCountList(monthDetailList)

    const periodCards: PeriodCard[] = [
      {
        key: 'day',
        title: anchorDate === today ? '本日' : '当日',
        subtitle: formatDateShort(anchorDate),
        rangeStart: dayRange[0],
        rangeEnd: dayRange[1],
        count: dayStat.rows.length,
        totalFee: dayStat.total.toFixed(2),
        bossFee: dayStat.bossTotal.toFixed(2),
        teacherFee: dayStat.teacherTotal.toFixed(2),
      },
      {
        key: 'week',
        title: anchorDate === today ? '本周' : '当周',
        subtitle: formatWeekRange(weekRange),
        rangeStart: weekRange[0],
        rangeEnd: weekRange[1],
        count: weekStat.rows.length,
        totalFee: weekStat.total.toFixed(2),
        bossFee: weekStat.bossTotal.toFixed(2),
        teacherFee: weekStat.teacherTotal.toFixed(2),
      },
      {
        key: 'month',
        title: anchorDate === today ? '本月' : '当月',
        subtitle: `${formatDateShort(monthRange[0])} - ${formatDateShort(monthRange[1])}`,
        rangeStart: monthRange[0],
        rangeEnd: monthRange[1],
        count: monthStat.rows.length,
        totalFee: monthStat.total.toFixed(2),
        bossFee: monthStat.bossTotal.toFixed(2),
        teacherFee: monthStat.teacherTotal.toFixed(2),
      },
    ]

    const defaultBossSharePercent = weekStat.globalBossSharePercent
    const defaultTeacherSharePercent = 100 - defaultBossSharePercent

    const summaryYear = Number(this.data.summaryYear) || new Date().getFullYear()
    const yearDisp = computeYearSummaryDisplay(summaryYear, courses, students, settings, getStudioExpenses())

    this.setData({
      anchorDate,
      anchorDateText: formatDateShort(anchorDate),
      isTodayAnchor: anchorDate === today,
      periodCards,
      pricePerClass: globalPrice,
      defaultBossSharePercent,
      defaultTeacherSharePercent,
      dayDetailList,
      weekDetailList,
      monthDetailList,
      dayStudentCountList,
      weekStudentCountList,
      monthStudentCountList,
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
    this.applyActivePeriod()
  },

  onPeriodCardTap(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const key = e.currentTarget.dataset.key as PeriodKey
    if (!key) return
    this.applyActivePeriod(key)
  },

  onStudentCountTap(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const name = String(e.currentTarget.dataset.name || '').trim()
    if (!name) return
    const start = String(this.data.currentRangeStart || '').trim()
    const end = String(this.data.currentRangeEnd || '').trim()
    if (!start || !end) return
    const periodTitle = String(this.data.currentTitle || '该周期')
    const subtitle = String(this.data.currentSubtitle || '')
    const qName = encodeURIComponent(name)
    const qTitle = encodeURIComponent(periodTitle)
    const qSub = encodeURIComponent(subtitle)
    wx.navigateTo({
      url: `/pages/stats/student-courses/student-courses?studentName=${qName}&start=${start}&end=${end}&periodTitle=${qTitle}&subtitle=${qSub}`,
    })
  },

  onAnchorDatePick(e: WechatMiniprogram.PickerChange) {
    playTouchSound()
    const picked = String(e.detail.value || '')
    if (!picked) return
    this.setData({ anchorDate: picked })
    this.refresh()
  },

  onResetAnchorToday() {
    playTouchSound()
    const today = getTodayStr()
    this.setData({ anchorDate: today })
    this.refresh()
  },

  onQuickPrev() {
    playTouchSound()
    const active = this.data.activePeriod as PeriodKey
    const base = this.data.anchorDate || getTodayStr()
    const next =
      active === 'day' ? shiftDate(base, -1) : active === 'week' ? shiftDate(base, -7) : shiftMonth(base, -1)
    this.setData({ anchorDate: next })
    this.refresh()
  },

  onQuickNext() {
    playTouchSound()
    const active = this.data.activePeriod as PeriodKey
    const base = this.data.anchorDate || getTodayStr()
    const next =
      active === 'day' ? shiftDate(base, 1) : active === 'week' ? shiftDate(base, 7) : shiftMonth(base, 1)
    this.setData({ anchorDate: next })
    this.refresh()
  },

  /** 点击明细卡片：跳转当日排课页 */
  goToDay(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const date = e.currentTarget.dataset.date as string
    if (date) wx.navigateTo({ url: `/pages/day/day?date=${date}` })
  },

  goMonth() {
    playTouchSound()
    wx.reLaunch({ url: '/pages/index/index' })
  },

  goWeek() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/week/week' })
  },

  goSettings() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  goStudioExpenses() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/studio-expenses/studio-expenses' })
  },

  onSummaryYearPick(e: WechatMiniprogram.PickerChange) {
    playTouchSound()
    const v = String(e.detail.value || '')
    const y = Number(v.slice(0, 4))
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return
    this.setData({ summaryYear: y, summaryYearPickerValue: `${y}-01-01` })
    this.refresh()
  },

  onOpenShareModal() {
    playTouchSound()
    this.setData({ showShareModal: true })
  },

  onCloseShareModal() {
    playTouchSound()
    this.setData({ showShareModal: false })
  },

  onOpenYearShareModal() {
    playTouchSound()
    this.setData({ showYearShareModal: true })
  },

  onCloseYearShareModal() {
    playTouchSound()
    this.setData({ showYearShareModal: false })
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
    this.setData({ showYearShareModal: false })
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

  onCopyWeekFeeShare() {
    playTouchSound()
    const courses = getCourses()
    const students = getStudents()
    const settings = getSettings()
    const anchor = this.data.anchorDate || getTodayStr()
    const range = getWeekRangeByDate(anchor)
    const text = buildFeeShareText('当周费用统计', range, courses, students, settings)
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制当周统计', icon: 'success' })
  },

  onCopyMonthFeeShare() {
    playTouchSound()
    const courses = getCourses()
    const students = getStudents()
    const settings = getSettings()
    const anchor = this.data.anchorDate || getTodayStr()
    const range = getMonthRangeByDate(anchor)
    const [y, m] = range[0].split('-').map(Number)
    const text = buildFeeShareText(`${y}年${m}月费用统计`, range, courses, students, settings)
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制当月统计', icon: 'success' })
  },

  onShareWeekFeeImage() {
    playTouchSound()
    this.setData({ showShareModal: false })
    const anchor = this.data.anchorDate || getTodayStr()
    wx.navigateTo({ url: `/pages/schedule-image/schedule-image?type=fee-week&baseDate=${anchor}` })
  },

  onShareDayFeeImagePick(e: WechatMiniprogram.PickerChange) {
    playTouchSound()
    const date = (e.detail.value as string) || ''
    if (!date) return
    this.setData({ showShareModal: false })
    wx.navigateTo({ url: `/pages/schedule-image/schedule-image?type=fee-day&date=${date}` })
  },

  onShareMonthFeeImage() {
    playTouchSound()
    this.setData({ showShareModal: false })
    const anchor = this.data.anchorDate || getTodayStr()
    wx.navigateTo({ url: `/pages/schedule-image/schedule-image?type=fee-month&baseDate=${anchor}` })
  },
})
