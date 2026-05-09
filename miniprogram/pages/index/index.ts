/**
 * 月视图：日历，有课日期淡色标记，点击进入当天排课
 * UTF-8
 */

import {
  getBossViewingTeacherInfo,
  getCourses,
  getCurrentUserOpenid,
  getStudents,
  nextId,
  setCourses,
  setStudents,
} from '../../utils/storage'
import { playTouchSound } from '../../utils/sound'
import { getTodayStr } from '../../utils/dateRange'
import { hardRequireProfileSetup } from '../../utils/profileEnforce'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'
import {
  ensureBossViewingTeacherFallback,
  openBossTeacherSwitch,
  refreshBossViewingTeacherFromCloud,
} from '../../utils/bossSwitch'
import { backupCurrentUserToCloud, drainPendingCloudBackup } from '../../utils/cloud'
import type { Course, Student } from '../../types/index'

interface DayItem {
  key: string
  date: string
  day: number | string
  empty: boolean
  today: boolean
  hasClass: boolean
}

type ParsedShareCourse = Pick<Course, 'date' | 'startTime' | 'duration' | 'studentName'>

const SHARE_LINE_REGEX = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\d{1,4})分钟\s+(.+)$/

function isValidDateStr(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() + 1 === mo && dt.getDate() === d
}

function isValidTimeStr(s: string): boolean {
  const m = s.match(/^(\d{2}):(\d{2})$/)
  if (!m) return false
  const h = Number(m[1])
  const mm = Number(m[2])
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59
}

function parseMonthShareText(raw: string): ParsedShareCourse[] {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)

  const parsed: ParsedShareCourse[] = []
  for (const line of lines) {
    // 只解析“YYYY-MM-DD HH:mm N分钟 学生名”格式；标题行/空行会自动跳过
    if (!line.includes('分钟')) continue
    const m = line.match(SHARE_LINE_REGEX)
    if (!m) continue
    const date = m[1]
    const startTime = m[2]
    const duration = Number(m[3])
    const studentName = m[4].trim()
    if (!isValidDateStr(date) || !isValidTimeStr(startTime)) continue
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600) continue
    if (!studentName) continue
    parsed.push({ date, startTime, duration, studentName })
  }
  return parsed
}

Page({
  data: {
    viewMode: 'month' as 'month' | 'week',
    year: 0,
    month: 0,
    calendarDays: [] as DayItem[],
    userScopeText: '游客模式',
    showShareModal: false,
    shareText: '',
    showImportModal: false,
    importTextDraft: '',
    isBoss: false,
    bossViewingLine: '',
    bossViewingHint: '',
    bossViewModeText: '',
    bossViewModeClass: '',
  },

  onLoad() {
    const now = new Date()
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1 })
    this.setData({ isBoss: isBossUser() })
    this.syncBossViewInfo()
    this.refreshUserScope()
    this.buildCalendar()
  },

  onShow() {
    if (hardRequireProfileSetup()) return
    this.setData({ isBoss: isBossUser() })
    this.syncBossViewInfo()
    this.refreshUserScope()
    this.buildCalendar()
    // 老板查看他人时：静默拉取对方最新云端备份；本人：重试上次失败的云备份
    if (isBossUser() && !isBossViewingSelf()) {
      void refreshBossViewingTeacherFromCloud().then((changed) => {
        if (changed) {
          this.syncBossViewInfo()
          this.buildCalendar()
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
          this.buildCalendar()
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
      this.buildCalendar()
    })
  },

  refreshUserScope() {
    const openid = getCurrentUserOpenid()
    this.setData({ userScopeText: openid ? `当前用户：${openid}` : '当前用户：游客模式' })
  },

  switchToMonth() {
    playTouchSound()
    this.setData({ viewMode: 'month' })
  },

  goWeek() {
    playTouchSound()
    wx.navigateTo({ url: '/pages/week/week' })
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
      shareText: this.buildMonthShareText(),
    })
  },

  onCloseShareModal() {
    playTouchSound()
    this.setData({ showShareModal: false })
  },

  onOpenImportModal() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    this.setData({ showImportModal: true, importTextDraft: '' })
  },

  onCloseImportModal() {
    playTouchSound()
    this.setData({ showImportModal: false, importTextDraft: '' })
  },

  onImportTextInput(e: WechatMiniprogram.Input) {
    this.setData({ importTextDraft: String(e.detail.value || '') })
  },

  async onConfirmImportFromShareText() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const raw = String(this.data.importTextDraft || '').trim()
    if (!raw) {
      wx.showToast({ title: '请先粘贴分享文本', icon: 'none' })
      return
    }
    const parsed = parseMonthShareText(raw)
    if (!parsed.length) {
      wx.showToast({ title: '未识别到可导入课程，请检查格式', icon: 'none', duration: 2600 })
      return
    }

    const { year, month } = this.data
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`
    // 当前策略：导入仅作用于“正在查看的月份”
    const parsedInMonth = parsed.filter((c) => c.date.startsWith(monthPrefix))
    const skippedOutOfMonth = parsed.length - parsedInMonth.length
    if (!parsedInMonth.length) {
      wx.showToast({ title: `文本中未找到 ${year}年${month}月 课程`, icon: 'none' })
      return
    }

    const uniqueSet = new Set<string>()
    // 同一份文本内去重（避免重复粘贴同一行）
    const toAdd = parsedInMonth.filter((c) => {
      const key = `${c.date}|${c.startTime}|${c.duration}|${c.studentName}`
      if (uniqueSet.has(key)) return false
      uniqueSet.add(key)
      return true
    })

    const existing = getCourses()
    const existingMonthCount = existing.filter((c) => c.date.startsWith(monthPrefix)).length
    const skippedDuplicateInText = parsedInMonth.length - toAdd.length

    wx.showModal({
      title: '确认导入课程',
      content:
        `将覆盖 ${year}年${month}月 原有课程 ${existingMonthCount} 条，导入 ${toAdd.length} 条。` +
        `\n文本内重复跳过 ${skippedDuplicateInText} 条，非本月跳过 ${skippedOutOfMonth} 条。` +
        '\n是否继续？',
      confirmText: '确认导入',
      confirmColor: '#007AFF',
      success: async (res) => {
        if (!res.confirm) return
        if (!toAdd.length) {
          wx.showToast({ title: '无可导入课程', icon: 'none' })
          this.setData({ showImportModal: false, importTextDraft: '' })
          return
        }
        const addedCourses: Course[] = toAdd.map((c) => ({
          id: nextId(),
          date: c.date,
          startTime: c.startTime,
          duration: c.duration,
          studentName: c.studentName,
        }))
        const currentStudents = getStudents()
        const studentNameSet = new Set(currentStudents.map((s) => (s.name || '').trim()).filter(Boolean))
        const autoAddedStudents: Student[] = []
        for (const c of addedCourses) {
          const name = (c.studentName || '').trim()
          if (!name || studentNameSet.has(name)) continue
          studentNameSet.add(name)
          autoAddedStudents.push({ id: nextId(), name })
        }

        // 覆盖导入：先清掉该月旧课程，再写入导入课程
        const kept = existing.filter((c) => !c.date.startsWith(monthPrefix))
        setCourses(kept.concat(addedCourses))
        if (autoAddedStudents.length) {
          setStudents(currentStudents.concat(autoAddedStudents))
        }
        this.setData({ showImportModal: false, importTextDraft: '' })
        this.buildCalendar()
        void backupCurrentUserToCloud()
        if (autoAddedStudents.length) {
          const names = autoAddedStudents.map((s) => s.name)
          const shown = names.slice(0, 3).join('、')
          const suffix = names.length > 3 ? ` 等${names.length}位` : ''
          wx.showToast({
            title: `已导入${addedCourses.length}条，${shown}${suffix}已自动加入学生列表`,
            icon: 'none',
            duration: 2800,
          })
        } else {
          wx.showToast({ title: `已导入 ${addedCourses.length} 条`, icon: 'success' })
        }
      },
    })
  },

  buildMonthShareText(): string {
    const { year, month } = this.data
    const prefix = `${year}-${String(month).padStart(2, '0')}-`
    const courses = getCourses()
      .filter((c) => c.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    if (!courses.length) return `${year}年${month}月暂无课程`
    const lines = courses.map((c) => `${c.date} ${c.startTime} ${c.duration}分钟 ${c.studentName}`)
    return `${year}年${month}月课表\n` + lines.join('\n')
  },

  onCopyShareText() {
    playTouchSound()
    const text = (this.data.shareText as string) || this.buildMonthShareText()
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

  prevMonth() {
    playTouchSound()
    let { year, month } = this.data
    month--
    if (month < 1) { month = 12; year-- }
    this.setData({ year, month })
    this.buildCalendar()
  },

  nextMonth() {
    playTouchSound()
    let { year, month } = this.data
    month++
    if (month > 12) { month = 1; year++ }
    this.setData({ year, month })
    this.buildCalendar()
  },

  buildCalendar() {
    const { year, month } = this.data
    const courses = getCourses()
    const dateSet = new Set(courses.map((c) => c.date))

    // 当月 1 号的星期：0=周日 … 6=周六，与表头「日一二…六」对齐
    const first = new Date(year, month - 1, 1)
    const last = new Date(year, month, 0)
    const firstWeekday = first.getDay()
    const daysInMonth = last.getDate()
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // 固定 6 行 × 7 列 = 42 格，按格子下标对应星期，避免 flex 换行错位
    const totalCells = 6 * 7
    const calendarDays: DayItem[] = []

    for (let i = 0; i < totalCells; i++) {
      if (i < firstWeekday || i >= firstWeekday + daysInMonth) {
        calendarDays.push({ key: `e-${i}`, date: '', day: '', empty: true, today: false, hasClass: false })
      } else {
        const d = i - firstWeekday + 1
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        calendarDays.push({
          key: date,
          date,
          day: d,
          empty: false,
          today: date === todayStr,
          hasClass: dateSet.has(date),
        })
      }
    }

    this.setData({ calendarDays })
  },

  onDayTap(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const date = e.currentTarget.dataset.date as string
    if (!date) return
    wx.navigateTo({ url: `/pages/day/day?date=${date}` })
  },
})
