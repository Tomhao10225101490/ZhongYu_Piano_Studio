/**
 * 课表图片页：Canvas 绘制本周/当日课表，或本周/本月费用统计图，导出为图片供分享/保存
 * UTF-8
 */

import { getCourses, getStudents, getSettings } from '../../utils/storage'
import { getWeekRange, getTodayStr, formatDateShort, formatWeekRange, getMonthRange } from '../../utils/dateRange'
import { listFeeDetailsInRange } from '../../utils/feeStats'
import { timeToMinutes, minutesToTime } from '../../utils/schedule'
import { playTouchSound } from '../../utils/sound'
import type { Course } from '../../types/index'

const CANVAS_WIDTH = 600
const PAD = 28
const ROW_HEIGHT_SCHEDULE = 52
const ROW_HEIGHT_FEE = 48
const HEADER_SCHEDULE = 120
/** 费用图：标题白块高度（含两行副标题时的空间） */
const FEE_WHITE_H = 158
/** 白块底到表头的间距，避免与「钟于钢琴工作室」区域重叠 */
const FEE_GAP_AFTER_WHITE = 30
/** 表头行（日期/时间…）高度 */
const FEE_TABLE_HEADER_ROW_H = 30
const BOTTOM_PAD = 40
const MAX_CANVAS_H = 2000

function inRange(date: string, [start, end]: [string, string]): boolean {
  return date >= start && date <= end
}

type FeeCanvasRow = {
  dateShort: string
  timeStr: string
  name: string
  sharePercentStr: string
  bossFeeStr: string
  teacherFeeStr: string
}

function truncateName(s: string, maxChars: number): string {
  const t = s.trim()
  if (t.length <= maxChars) return t
  return t.slice(0, Math.max(0, maxChars - 1)) + '…'
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

Page({
  data: {
    mode: 'schedule' as 'schedule' | 'fee' | 'year-summary',
    title: '',
    subtitle: '',
    feeSummary: '',
    yearSummaryRows: [] as { label: string; value: string; tone?: 'boss' | 'teacher' | 'expense' | 'net' }[],
    courseList: [] as Course[],
    feeRows: [] as FeeCanvasRow[],
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: 400,
    imagePath: '',
  },

  onLoad(opt: {
    type?: string
    date?: string
    baseDate?: string
    year?: string
    y?: string
    classes?: string
    total?: string
    boss?: string
    teacher?: string
    expense?: string
    net?: string
    bossNet?: string
  }) {
    const type = opt?.type || 'week'
    const courses = getCourses()

    if (type === 'year-summary') {
      const year = Number(opt?.year || opt?.y || new Date().getFullYear())
      const safeYear = Number.isFinite(year) ? year : new Date().getFullYear()
      const rows = [
        { label: '上课节数', value: `${String(opt?.classes || '0')} 节` },
        { label: '课时费合计', value: `¥ ${String(opt?.total || '0.00')}` },
        { label: '老板所得', value: `¥ ${String(opt?.boss || '0.00')}`, tone: 'boss' as const },
        { label: '教师所得', value: `¥ ${String(opt?.teacher || '0.00')}`, tone: 'teacher' as const },
        { label: '工作室支出（本年度）', value: `¥ ${String(opt?.expense || '0.00')}`, tone: 'expense' as const },
        { label: '全年结余（课费合计 − 固定支出）', value: `¥ ${String(opt?.net || '0.00')}`, tone: 'net' as const },
        { label: '老板净得（老板所得 − 固定支出）', value: `¥ ${String(opt?.bossNet || '0.00')}`, tone: 'boss' as const },
      ]
      const canvasHeight = 680
      wx.setNavigationBarTitle({ title: '年度汇总图' })
      this.setData({
        mode: 'year-summary',
        title: '钟于钢琴工作室',
        subtitle: `${safeYear} 年度汇总`,
        yearSummaryRows: rows,
        canvasHeight,
      })
      return
    }

    if (type === 'fee-week' || type === 'fee-month' || type === 'fee-day' || type === 'fee-year') {
      const students = getStudents()
      const settings = getSettings()
      const baseDate = (opt?.baseDate || getTodayStr()).trim()
      const range =
        type === 'fee-week'
          ? getWeekRangeByDate(baseDate)
          : type === 'fee-month'
            ? getMonthRangeByDate(baseDate)
            : type === 'fee-year'
              ? (() => {
                  const y = Number((opt?.year || baseDate.slice(0, 4) || '').trim())
                  const yy = Number.isFinite(y) ? y : new Date().getFullYear()
                  return [`${yy}-01-01`, `${yy}-12-31`] as [string, string]
                })()
            : (() => {
                const d = (opt?.date || getTodayStr()).trim()
                return [d, d] as [string, string]
              })()
      const { rows, total, bossTotal, teacherTotal, globalPrice, globalBossSharePercent } = listFeeDetailsInRange(
        range,
        courses,
        students,
        settings,
      )
      const [y, mo] = range[0].split('-').map(Number)
      const feeSubtitle =
        type === 'fee-week'
          ? `当周费用统计 ${formatWeekRange(range)}`
          : type === 'fee-month'
            ? `${y}年${mo}月费用统计（${formatDateShort(range[0])}-${formatDateShort(range[1])}）`
            : type === 'fee-year'
              ? `${y}年费用统计（${formatDateShort(range[0])}-${formatDateShort(range[1])}）`
            : `${formatDateShort(range[0])} 费用统计`
      const feeSummary = `共${rows.length}节 总¥${total.toFixed(2)} 老板¥${bossTotal.toFixed(2)} 教师¥${teacherTotal.toFixed(2)}`
      const feeRows: FeeCanvasRow[] = rows.map(({ course: c, bossFee, teacherFee, bossSharePercent }) => {
        return {
          dateShort: formatDateShort(c.date),
          timeStr: `${c.startTime}-${minutesToTime(timeToMinutes(c.startTime) + c.duration)}`,
          name: c.studentName,
          sharePercentStr: `${bossSharePercent}/${100 - bossSharePercent}`,
          bossFeeStr: bossFee.toFixed(2),
          teacherFeeStr: teacherFee.toFixed(2),
        }
      })
      const whiteBottom = PAD + FEE_WHITE_H
      const tableHeaderTop = whiteBottom + FEE_GAP_AFTER_WHITE
      const lineY = tableHeaderTop + FEE_TABLE_HEADER_ROW_H
      const dataRows = Math.max(feeRows.length, 1)
      const canvasHeight = Math.min(lineY + dataRows * ROW_HEIGHT_FEE + BOTTOM_PAD, MAX_CANVAS_H)
      wx.setNavigationBarTitle({
        title:
          type === 'fee-week'
            ? '当周费用统计图'
            : type === 'fee-month'
              ? '当月费用统计图'
              : type === 'fee-year'
                ? '年度费用统计图'
              : '当日费用统计图',
      })
      this.setData({
        mode: 'fee',
        title: '钟于钢琴工作室',
        subtitle: `${feeSubtitle}（全局老板分成${globalBossSharePercent}% · 基准${globalPrice}元/45分钟）`,
        feeSummary,
        feeRows,
        canvasHeight,
      })
      return
    }

    let list: Course[]
    let title: string
    let subtitle: string

    if (type === 'day') {
      const date = opt?.date || getTodayStr()
      list = courses.filter((c) => c.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime))
      const [yy, mm, dd] = date.split('-').map(Number)
      title = '钟于钢琴工作室'
      subtitle = `${yy}年${mm}月${dd}日 课表`
    } else {
      const [start, end] = getWeekRange()
      list = courses
        .filter((c) => inRange(c.date, [start, end]))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      title = '钟于钢琴工作室'
      subtitle = '本周课表 ' + formatWeekRange([start, end])
    }

    const canvasHeight = Math.min(
      HEADER_SCHEDULE + Math.max(list.length, 1) * ROW_HEIGHT_SCHEDULE + BOTTOM_PAD,
      1400,
    )
    wx.setNavigationBarTitle({ title: '课表图片' })
    this.setData({
      mode: 'schedule',
      title,
      subtitle,
      courseList: list,
      canvasHeight,
    })
  },

  onReady() {
    this.drawCanvas()
  },

  drawCanvas() {
    if (this.data.mode === 'fee') {
      this.drawFeeCanvas()
      return
    }
    if (this.data.mode === 'year-summary') {
      this.drawYearSummaryCanvas()
      return
    }
    this.drawScheduleCanvas()
  },

  drawYearSummaryCanvas() {
    const ctx = wx.createCanvasContext('scheduleCanvas', this)
    const w = CANVAS_WIDTH
    const h = this.data.canvasHeight as number
    const pad = PAD
    const rows = this.data.yearSummaryRows as { label: string; value: string; tone?: 'boss' | 'teacher' | 'expense' | 'net' }[]

    ctx.setFillStyle('#F2F2F7')
    ctx.fillRect(0, 0, w, h)

    ctx.setFillStyle('rgba(255,255,255,0.95)')
    ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2)

    ctx.setFillStyle('#1C1C1E')
    ctx.setFontSize(22)
    ctx.setTextAlign('center')
    ctx.fillText('钟于钢琴工作室', w / 2, pad + 34)
    ctx.setFillStyle('#8E8E93')
    ctx.setFontSize(14)
    ctx.fillText(this.data.subtitle as string, w / 2, pad + 60)

    let y = pad + 96
    ctx.setStrokeStyle('rgba(0,0,0,0.08)')
    ctx.setLineWidth(1)
    rows.forEach((r, idx) => {
      ctx.setFillStyle('#3A3A3C')
      ctx.setFontSize(13)
      ctx.setTextAlign('left')
      ctx.fillText(r.label, pad + 16, y)
      ctx.setTextAlign('right')
      let valueColor = '#1C1C1E'
      if (r.tone === 'boss') valueColor = '#05945c'
      else if (r.tone === 'teacher') valueColor = '#007AFF'
      else if (r.tone === 'expense') valueColor = '#C45C7A'
      else if (r.tone === 'net') valueColor = '#111111'
      ctx.setFillStyle(valueColor)
      ctx.setFontSize(r.tone === 'net' ? 15 : 14)
      ctx.fillText(r.value, w - pad - 16, y)
      if (idx < rows.length - 1) {
        ctx.setStrokeStyle('rgba(0,0,0,0.06)')
        ctx.moveTo(pad + 12, y + 14)
        ctx.lineTo(w - pad - 12, y + 14)
        ctx.stroke()
      }
      y += 42
    })

    ctx.setTextAlign('center')
    ctx.setFillStyle('#8E8E93')
    ctx.setFontSize(11)
    ctx.fillText('教师所得为实得分成，不扣工作室固定支出', w / 2, h - pad - 18)

    ctx.draw(false, () => {
      this.canvasToImage()
    })
  },

  drawScheduleCanvas() {
    const { courseList, canvasHeight } = this.data
    const ctx = wx.createCanvasContext('scheduleCanvas', this)

    const w = CANVAS_WIDTH
    const h = canvasHeight
    const pad = PAD
    const rowH = ROW_HEIGHT_SCHEDULE

    ctx.setFillStyle('#F2F2F7')
    ctx.fillRect(0, 0, w, h)

    ctx.setFillStyle('rgba(255,255,255,0.92)')
    ctx.fillRect(pad, pad, w - pad * 2, 88)
    ctx.setFillStyle('#1C1C1E')
    ctx.setFontSize(22)
    ctx.setTextAlign('center')
    ctx.fillText('钟于钢琴工作室', w / 2, pad + 32)
    ctx.setFillStyle('#8E8E93')
    ctx.setFontSize(14)
    ctx.fillText(this.data.subtitle, w / 2, pad + 58)

    let y = HEADER_SCHEDULE
    ctx.setFillStyle('#3A3A3C')
    ctx.setFontSize(13)
    ctx.setTextAlign('left')
    ctx.fillText('日期', pad + 12, y - 18)
    ctx.fillText('时间', pad + 140, y - 18)
    ctx.fillText('学生', pad + 260, y - 18)
    ctx.setStrokeStyle('rgba(0,0,0,0.08)')
    ctx.setLineWidth(1)
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
    y += rowH

    if (courseList.length === 0) {
      ctx.setFillStyle('#8E8E93')
      ctx.setFontSize(14)
      ctx.setTextAlign('center')
      ctx.fillText('暂无课程', w / 2, y - 18)
    } else {
      courseList.forEach((c, i) => {
        const rowY = y - 18
        ctx.setFillStyle('#1C1C1E')
        ctx.setFontSize(14)
        ctx.setTextAlign('left')
        ctx.fillText(formatDateShort(c.date), pad + 12, rowY)
        const endTime = minutesToTime(timeToMinutes(c.startTime) + c.duration)
        ctx.fillText(`${c.startTime}-${endTime}`, pad + 140, rowY)
        ctx.setFillStyle('#007AFF')
        ctx.fillText(c.studentName, pad + 260, rowY)
        if (i < courseList.length - 1) {
          ctx.setStrokeStyle('rgba(0,0,0,0.06)')
          ctx.moveTo(pad, y)
          ctx.lineTo(w - pad, y)
          ctx.stroke()
        }
        y += rowH
      })
    }

    ctx.draw(false, () => {
      this.canvasToImage()
    })
  },

  drawFeeCanvas() {
    const { feeRows, feeSummary, canvasHeight } = this.data
    const ctx = wx.createCanvasContext('scheduleCanvas', this)
    const w = CANVAS_WIDTH
    const h = canvasHeight
    const pad = PAD
    const rowH = ROW_HEIGHT_FEE
    const whiteBottom = pad + FEE_WHITE_H
    const tableHeaderTop = whiteBottom + FEE_GAP_AFTER_WHITE
    const lineY = tableHeaderTop + FEE_TABLE_HEADER_ROW_H

    const COL_DATE = pad + 6
    const COL_TIME = pad + 88
    const COL_NAME = pad + 182
    const COL_SHARE = w - pad - 150
    const COL_BOSS = w - pad - 78
    const COL_TEACHER = w - pad - 6

    ctx.setFillStyle('#F2F2F7')
    ctx.fillRect(0, 0, w, h)

    ctx.setFillStyle('rgba(255,255,255,0.92)')
    ctx.fillRect(pad, pad, w - pad * 2, FEE_WHITE_H)
    ctx.setFillStyle('#1C1C1E')
    ctx.setFontSize(22)
    ctx.setTextAlign('center')
    ctx.fillText('钟于钢琴工作室', w / 2, pad + 28)
    ctx.setFillStyle('#3A3A3C')
    ctx.setFontSize(13)
    const sub = this.data.subtitle
    const twoLineSub = sub.length > 26
    if (twoLineSub) {
      ctx.fillText(sub.slice(0, 26), w / 2, pad + 52)
      ctx.fillText(sub.slice(26), w / 2, pad + 70)
    } else {
      ctx.fillText(sub, w / 2, pad + 52)
    }
    ctx.setFillStyle('#8E8E93')
    ctx.setFontSize(12)
    const summaryY = twoLineSub ? pad + 100 : pad + 88
    ctx.fillText(feeSummary, w / 2, summaryY)

    // 表头在灰底区域，与白块有明显间距（tableHeaderTop > whiteBottom）
    const headerBaseline = tableHeaderTop + 18
    ctx.setFillStyle('#3A3A3C')
    ctx.setFontSize(12)
    ctx.setTextAlign('left')
    ctx.fillText('日期', COL_DATE, headerBaseline)
    ctx.fillText('时间', COL_TIME, headerBaseline)
    ctx.fillText('学生', COL_NAME, headerBaseline)
    ctx.setTextAlign('right')
    ctx.fillText('比例', COL_SHARE, headerBaseline)
    ctx.fillText('老板', COL_BOSS, headerBaseline)
    ctx.fillText('教师', COL_TEACHER, headerBaseline)
    ctx.setTextAlign('left')
    ctx.setStrokeStyle('rgba(0,0,0,0.08)')
    ctx.setLineWidth(1)
    ctx.moveTo(pad, lineY)
    ctx.lineTo(w - pad, lineY)
    ctx.stroke()

    let y = lineY + rowH

    if (feeRows.length === 0) {
      ctx.setFillStyle('#8E8E93')
      ctx.setFontSize(14)
      ctx.setTextAlign('center')
      ctx.fillText('暂无课程', w / 2, y - 18)
    } else {
      feeRows.forEach((r, i) => {
        const rowY = y - 18
        ctx.setFillStyle('#1C1C1E')
        ctx.setFontSize(12)
        ctx.setTextAlign('left')
        ctx.fillText(r.dateShort, COL_DATE, rowY)
        ctx.setFontSize(11)
        ctx.fillText(r.timeStr, COL_TIME, rowY)
        ctx.setFontSize(12)
        ctx.setFillStyle('#007AFF')
        ctx.fillText(truncateName(r.name, 5), COL_NAME, rowY)
        ctx.setFillStyle('#8E8E93')
        ctx.setFontSize(10)
        ctx.setTextAlign('right')
        ctx.fillText(r.sharePercentStr, COL_SHARE, rowY)
        ctx.setFillStyle('#05945c')
        ctx.setFontSize(12)
        ctx.fillText(`¥${r.bossFeeStr}`, COL_BOSS, rowY)
        ctx.setFillStyle('#007AFF')
        ctx.fillText(`¥${r.teacherFeeStr}`, COL_TEACHER, rowY)
        ctx.setTextAlign('left')
        if (i < feeRows.length - 1) {
          ctx.setStrokeStyle('rgba(0,0,0,0.06)')
          ctx.moveTo(pad, y)
          ctx.lineTo(w - pad, y)
          ctx.stroke()
        }
        y += rowH
      })
    }

    ctx.draw(false, () => {
      this.canvasToImage()
    })
  },

  canvasToImage() {
    wx.canvasToTempFilePath(
      {
        canvasId: 'scheduleCanvas',
        success: (res) => {
          this.setData({ imagePath: res.tempFilePath })
        },
        fail: (err) => {
          console.error(err)
          wx.showToast({ title: '生成失败', icon: 'none' })
        },
      },
      this,
    )
  },

  onSavePhoto() {
    playTouchSound()
    const path = this.data.imagePath
    if (!path) return
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err: WechatMiniprogram.GeneralCallbackResult) => {
        if (err.errMsg && err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '请允许保存到相册，以便分享图片',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            },
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  onPreview() {
    playTouchSound()
    const path = this.data.imagePath
    if (path) wx.previewImage({ current: path, urls: [path] })
  },

  /** 唤起微信原生「转发图片」菜单（发送给朋友 / 收藏等），基础库 ≥2.14.3 */
  onForwardImage() {
    playTouchSound()
    const path = this.data.imagePath
    if (!path) return
    if (!wx.canIUse || !wx.canIUse('showShareImageMenu')) {
      wx.showModal({
        title: '提示',
        content: '当前微信版本较低，请先「保存到相册」，再在相册里长按图片发送给好友。',
        showCancel: false,
      })
      return
    }
    wx.showShareImageMenu({
      path,
      fail: (err: WechatMiniprogram.GeneralCallbackResult) => {
        const msg = err.errMsg || ''
        if (msg.indexOf('cancel') !== -1) return
        console.error(err)
        wx.showToast({ title: '无法打开转发', icon: 'none' })
      },
    })
  },
})
