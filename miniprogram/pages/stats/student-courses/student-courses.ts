import { getCourses, getSettings, getStudents } from '../../../utils/storage'
import { listFeeDetailsInRange } from '../../../utils/feeStats'
import type { FeeDetailRow } from '../../../utils/feeStats'
import { formatDateShort } from '../../../utils/dateRange'
import { isCourseFinished } from '../../../utils/schedule'
import { playTouchSound } from '../../../utils/sound'
import { hardRequireProfileSetup } from '../../../utils/profileEnforce'
import { isBossUser } from '../../../utils/boss'
import type { Course } from '../../../types/index'

type DetailItem = Course & {
  dateDisplay: string
  sharePercentDisplay: string
  bossFeeDisplay: string
  teacherFeeDisplay: string
  /** 展示「全部」时标记尚未结束的课程 */
  showPendingTag: boolean
}

Page({
  data: {
    isBoss: false,
    studentName: '',
    periodTitle: '',
    periodSubtitle: '',
    rangeStart: '',
    rangeEnd: '',
    courseCount: 0,
    totalFee: '0.00',
    bossFee: '0.00',
    teacherFee: '0.00',
    detailList: [] as DetailItem[],
    /** false=全部课程；true=只看已上完（与 day 页 isCourseFinished 一致） */
    filterFinishedOnly: false,
    emptyHint: '' as string,
  },

  onLoad(opt: {
    studentName?: string
    start?: string
    end?: string
    periodTitle?: string
    subtitle?: string
  }) {
    const studentName = decodeURIComponent(String(opt?.studentName || '')).trim()
    const start = String(opt?.start || '').trim()
    const end = String(opt?.end || '').trim()
    const periodTitle = decodeURIComponent(String(opt?.periodTitle || '该周期'))
    const subtitle = decodeURIComponent(String(opt?.subtitle || ''))
    this.setData({
      studentName,
      rangeStart: start,
      rangeEnd: end,
      periodTitle,
      periodSubtitle: subtitle,
    })
    this.refresh()
  },

  onSetFilterAll() {
    playTouchSound()
    if (!this.data.filterFinishedOnly) return
    this.setData({ filterFinishedOnly: false })
    this.refresh()
  },

  onSetFilterFinished() {
    playTouchSound()
    if (this.data.filterFinishedOnly) return
    this.setData({ filterFinishedOnly: true })
    this.refresh()
  },

  onShow() {
    if (hardRequireProfileSetup()) return
    this.setData({ isBoss: isBossUser() })
    this.refresh()
  },

  refresh() {
    const studentName = String(this.data.studentName || '').trim()
    const start = String(this.data.rangeStart || '').trim()
    const end = String(this.data.rangeEnd || '').trim()
    if (!studentName || !start || !end) return

    const courses = getCourses()
    const students = getStudents()
    const settings = getSettings()
    const stat = listFeeDetailsInRange([start, end], courses, students, settings)
    const forStudent = stat.rows.filter((r) => (r.course.studentName || '').trim() === studentName)
    const filterFinishedOnly = !!this.data.filterFinishedOnly
    const picked: FeeDetailRow[] = filterFinishedOnly
      ? forStudent.filter((r) =>
          isCourseFinished(r.course.date, r.course.startTime, r.course.duration),
        )
      : forStudent

    const detailList: DetailItem[] = picked.map((r) => {
      const finished = isCourseFinished(r.course.date, r.course.startTime, r.course.duration)
      return {
        ...r.course,
        dateDisplay: formatDateShort(r.course.date),
        sharePercentDisplay: `老板 ${r.bossSharePercent}% · 教师 ${100 - r.bossSharePercent}%`,
        bossFeeDisplay: r.bossFee.toFixed(2),
        teacherFeeDisplay: r.teacherFee.toFixed(2),
        showPendingTag: !filterFinishedOnly && !finished,
      }
    })

    const total = picked.reduce((sum, r) => sum + r.fee, 0)
    const bossTotal = picked.reduce((sum, r) => sum + r.bossFee, 0)
    const teacherTotal = picked.reduce((sum, r) => sum + r.teacherFee, 0)

    const emptyHint =
      picked.length === 0
        ? forStudent.length === 0
          ? '该学生在当前时间段暂无课程'
          : '该时间段内暂无已上完的课程'
        : ''

    this.setData({
      detailList,
      courseCount: picked.length,
      totalFee: total.toFixed(2),
      bossFee: bossTotal.toFixed(2),
      teacherFee: teacherTotal.toFixed(2),
      emptyHint,
    })
  },

  onGoDay(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    const date = String(e.currentTarget.dataset.date || '')
    if (!date) return
    wx.navigateTo({ url: `/pages/day/day?date=${date}` })
  },
})
