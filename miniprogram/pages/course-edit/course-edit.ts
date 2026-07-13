/**
 * 课程编辑页：新增/编辑；保存时执行「时间片冲突检测」与「自动顺延」
 * UTF-8
 */

import { getCourses, setCourses, getCoursesByDate, getStudents, setStudents } from '../../utils/storage'
import { getSettings } from '../../utils/storage'
import {
  hasConflict,
  autoShiftAfterUpdate,
  getRestorableShiftCount,
  restoreShiftedFollowersAfterUpdate,
  timeToMinutes,
  minutesToTime,
  isCourseFinished,
} from '../../utils/schedule'
import { playTouchSound } from '../../utils/sound'
import { insertCourseAndShift } from '../../utils/schedule'
import { DEFAULT_DURATION, REMINDER_OPTIONS } from '../../utils/constant'
import { backupCurrentUserToCloud } from '../../utils/cloud'
import { matchStudentsForSuggest } from '../../utils/studentSearch'
import type { Student } from '../../types/index'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'

const DURATIONS = [30, 45, 60, 90]
const MIN_DURATION = 1
const MAX_DURATION = 600

/** 学生选择器：首项为占位，其余与「学生名单」一致；排课不可手输姓名 */
const PICKER_NONE = '_none'

function clampDuration(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_DURATION
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(v)))
}

function buildDurationOptions(current: number): number[] {
  const cur = clampDuration(current)
  const set = new Set<number>(DURATIONS)
  set.add(cur)
  return Array.from(set).sort((a, b) => a - b)
}

/**
 * 统一“预设时长 + 自定义时长”状态。
 * 任何入口（选学生、手输分钟、编辑回显）都通过该函数收敛，避免 UI 状态分叉。
 */
function resolveDurationState(duration: number): { duration: number; durationOptions: number[]; durationIndex: number; customDurationDraft: string } {
  const d = clampDuration(duration)
  const durationOptions = buildDurationOptions(d)
  const idx = Math.max(0, durationOptions.indexOf(d))
  return {
    duration: d,
    durationOptions,
    durationIndex: idx,
    customDurationDraft: String(d),
  }
}

Page({
  data: {
    id: '' as string,
    date: '',
    dateDisplay: '',
    todayStr: '',
    isEdit: false,
    modalShow: false,
    modalTitle: '',
    modalContent: '',
    modalShowCancel: true,
    modalType: '' as 'conflict' | 'delete' | 'restore_shift' | 'repeat_same_day' | '',
    modalConfirmText: '确定',
    modalCancelText: '取消',
    isFinished: false,
    startTime: '',
    duration: 45,
    durationIndex: 1,
    durationOptions: DURATIONS,
    customDurationDraft: '45',
    studentName: '',
    /** 只读展示：来自学生名单（及全局单价兜底说明），不在此页修改 */
    studentPriceLine: '',
    /** 只读展示：来自学生名单（及全局分成兜底说明），不在此页修改 */
    studentShareLine: '',
    studentColor: '',
    reminderMinutes: 0,
    reminderIndex: 0,
    reminderOptions: [
      { value: 0, label: '不提醒' },
      { value: 15, label: '提前15分钟' },
      { value: 30, label: '提前30分钟' },
    ],
    /** 课程备注：如「下午」「待定」，仅本人可见，不参与排课时间计算 */
    note: '',
    studentPickerOptions: [] as { id: string; label: string }[],
    studentPickerIndex: 0,
    /** 输入姓名筛选（方式二） */
    studentSearchQuery: '',
    studentSuggestList: [] as { id: string; name: string }[],
    /** 名单是否非空（用于禁用选择与空态提示） */
    hasStudents: false,
    isBoss: false,
    /** 编辑时：课程上的姓名已不在当前名单中，需用户重选 */
    orphanStudentName: '' as string,
  },

  onLoad(opt: { id?: string; date?: string; startTime?: string }) {
    const date = opt?.date || this.todayStr()
    const [y, m, d] = date.split('-').map(Number)
    const settings = getSettings()
    const defaultDur = settings.defaultDuration ?? DEFAULT_DURATION
    const durationState = resolveDurationState(defaultDur)

    this.setData({
      date,
      todayStr: this.todayStr(),
      dateDisplay: `${y}年${m}月${d}日`,
      duration: durationState.duration,
      durationIndex: durationState.durationIndex,
      durationOptions: durationState.durationOptions,
      customDurationDraft: durationState.customDurationDraft,
    })

    if (opt?.id) {
      const all = getCourses()
      const course = all.find((c) => c.id === opt.id)
      if (course) {
        const durationStateForEdit = resolveDurationState(course.duration)
        let ri = 0
        if (course.reminderMinutes === 15) ri = 1
        else if (course.reminderMinutes === 30) ri = 2
        const finished = isCourseFinished(course.date, course.startTime, course.duration)
        const roster = getStudents()
        const matched = roster.find((s) => s.name === course.studentName)
        const patch: Record<string, unknown> = {
          id: course.id,
          isEdit: true,
          isFinished: finished,
          startTime: course.startTime,
          duration: durationStateForEdit.duration,
          durationIndex: durationStateForEdit.durationIndex,
          durationOptions: durationStateForEdit.durationOptions,
          customDurationDraft: durationStateForEdit.customDurationDraft,
          studentColor: course.studentColor || '',
          reminderMinutes: course.reminderMinutes ?? 0,
          reminderIndex: ri,
          note: course.note || '',
          orphanStudentName: '',
        }
        if (matched) {
          patch.studentName = matched.name
        } else {
          patch.studentName = ''
          patch.orphanStudentName = course.studentName
        }
        this.setData(patch)
      }
    } else {
      const forced = String(opt?.startTime || '').trim()
      const ok = /^\d{2}:\d{2}$/.test(forced) ? (() => {
        const [hh, mm] = forced.split(':').map(Number)
        return Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
      })() : false
      this.setData({ startTime: ok ? forced : this.suggestNextStart(date) })
    }

    this.refreshStudentPickerState()
  },

  onShow() {
    this.setData({ isBoss: isBossUser() })
    this.refreshStudentPickerState()
  },

  /** 刷新名单选项、是否有学生、并根据当前 studentName 对齐选择器（仅匹配名单内姓名） */
  refreshStudentPickerState() {
    const roster = getStudents()
    const hasStudents = roster.length > 0
    const options = this.buildStudentPickerOptions()
    const name = String(this.data.studentName || '').trim()
    let studentPickerIndex = 0
    if (name) {
      const idx = options.findIndex(
        (o) => o.id !== PICKER_NONE && o.label === name,
      )
      if (idx >= 0) studentPickerIndex = idx
    }
    this.setData({
      hasStudents,
      studentPickerOptions: options,
      studentPickerIndex,
      studentPriceLine: this.formatPriceLine(name),
      studentShareLine: this.formatShareLine(name),
    })
  },

  /** 与名单、全局设置一致，仅用于展示 */
  formatPriceLine(studentName: string): string {
    const n = (studentName || '').trim()
    if (!n) return '请先选择学生'
    const s = getStudents().find((x) => x.name === n)
    if (!s) return '—'
    if (s.pricePerClass && s.pricePerClass > 0) {
      return `${s.pricePerClass} 元 / 45 分钟`
    }
    const g = getSettings().pricePerClass
    if (g !== undefined && g !== null && Number(g) > 0) {
      return `未单独设置 · 统计按全局 ${g} 元/45 分钟`
    }
    return '未设置单价（请到学生名单填写）'
  },

  /** 与名单、全局设置一致，仅用于展示 */
  formatShareLine(studentName: string): string {
    const n = (studentName || '').trim()
    if (!n) return '请先选择学生'
    const s = getStudents().find((x) => x.name === n)
    if (!s) return '—'
    const global = Number(getSettings().bossSharePercent ?? 0)
    const globalBoss = Math.min(100, Math.max(0, Number.isFinite(global) ? Math.floor(global) : 0))
    if (typeof s.bossSharePercent === 'number' && Number.isFinite(s.bossSharePercent)) {
      const p = Math.min(100, Math.max(0, Math.floor(s.bossSharePercent)))
      return `老板 ${p}% · 教师 ${100 - p}%`
    }
    return `未单独设置 · 统计按全局 老板 ${globalBoss}% · 教师 ${100 - globalBoss}%`
  },

  buildStudentPickerOptions(): { id: string; label: string }[] {
    const students = getStudents()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return [
      { id: PICKER_NONE, label: '请选择学生' },
      ...students.map((s) => ({ id: s.id, label: s.name })),
    ]
  },

  onStudentPickerChange(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value)
    const opts = this.data.studentPickerOptions
    const opt = opts[i]
    if (!opt) return
    if (opt.id === PICKER_NONE) {
      this.setData({
        studentPickerIndex: i,
        studentName: '',
        studentPriceLine: this.formatPriceLine(''),
        studentShareLine: this.formatShareLine(''),
        studentColor: '',
        studentSearchQuery: '',
        studentSuggestList: [],
      })
      return
    }
    const s = getStudents().find((x) => x.id === opt.id)
    if (!s) return
    const durationState = resolveDurationState(s.defaultDuration ?? this.data.duration ?? DEFAULT_DURATION)
    this.setData({
      studentPickerIndex: i,
      studentName: s.name,
      studentPriceLine: this.formatPriceLine(s.name),
      studentShareLine: this.formatShareLine(s.name),
      studentColor: s.color || '',
      duration: durationState.duration,
      durationIndex: durationState.durationIndex,
      durationOptions: durationState.durationOptions,
      customDurationDraft: durationState.customDurationDraft,
      orphanStudentName: '',
      studentSearchQuery: '',
      studentSuggestList: [],
    })
  },

  onStudentSearchInput(e: WechatMiniprogram.Input) {
    const raw = e.detail.value || ''
    const roster = getStudents()
    const matches = matchStudentsForSuggest(roster, raw, 24)
    this.setData({
      studentSearchQuery: raw,
      studentSuggestList: matches.map((s) => ({ id: s.id, name: s.name })),
    })
  },

  onPickStudentFromSuggest(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const s = getStudents().find((x) => x.id === id)
    if (!s) return
    playTouchSound()
    const options = this.buildStudentPickerOptions()
    const idx = options.findIndex((o) => o.id === s.id)
    const durationState = resolveDurationState(s.defaultDuration ?? this.data.duration ?? DEFAULT_DURATION)
    this.setData({
      studentPickerIndex: idx >= 0 ? idx : 0,
      studentName: s.name,
      studentPriceLine: this.formatPriceLine(s.name),
      studentShareLine: this.formatShareLine(s.name),
      studentColor: s.color || '',
      duration: durationState.duration,
      durationIndex: durationState.durationIndex,
      durationOptions: durationState.durationOptions,
      customDurationDraft: durationState.customDurationDraft,
      orphanStudentName: '',
      studentSearchQuery: '',
      studentSuggestList: [],
    })
  },

  onOpenStudents() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/students/students' })
  },

  todayStr(): string {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  },

  suggestNextStart(date: string): string {
    const list = getCoursesByDate(date)
    if (list.length === 0) return '09:00'
    const last = list[list.length - 1]
    return minutesToTime(timeToMinutes(last.startTime) + last.duration)
  },

  onStartTimeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ startTime: String(e.detail.value || '') })
  },

  onDurationChange(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value)
    const options = this.data.durationOptions as number[]
    const picked = Number(options[i])
    if (!Number.isFinite(picked) || picked <= 0) return
    const durationState = resolveDurationState(picked)
    this.setData({
      durationIndex: durationState.durationIndex,
      duration: durationState.duration,
      durationOptions: durationState.durationOptions,
      customDurationDraft: durationState.customDurationDraft,
    })
  },

  onCustomDurationInput(e: WechatMiniprogram.Input) {
    const raw = String(e.detail.value || '').replace(/[^\d]/g, '')
    this.setData({ customDurationDraft: raw })
  },

  onCustomDurationConfirm() {
    const raw = String(this.data.customDurationDraft || '').trim()
    if (!raw) {
      wx.showToast({ title: `请输入${MIN_DURATION}-${MAX_DURATION}分钟`, icon: 'none' })
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < MIN_DURATION || n > MAX_DURATION) {
      wx.showToast({ title: `时长需在${MIN_DURATION}-${MAX_DURATION}分钟`, icon: 'none' })
      return
    }
    const durationState = resolveDurationState(n)
    this.setData({
      duration: durationState.duration,
      durationIndex: durationState.durationIndex,
      durationOptions: durationState.durationOptions,
      customDurationDraft: durationState.customDurationDraft,
    })
  },

  onReminderChange(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value)
    this.setData({ reminderIndex: i, reminderMinutes: REMINDER_OPTIONS[i] })
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: String(e.detail.value || '') })
  },

  onSave() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    this.trySave(false)
  },

  /**
   * 保存前置检查：
   * - 新增时：同一自然日同学生若已排过课，从第二门开始给出确认提醒
   * - 再进入冲突检测 / 可恢复顺延检测 / 真正保存
   */
  trySave(skipRepeatSameDayCheck: boolean) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const { id, date, startTime, duration, reminderMinutes, isEdit, hasStudents } = this.data
    if (!hasStudents) {
      wx.showToast({ title: '请先在学生名单中添加学生', icon: 'none' })
      return
    }
    const studentName = String(this.data.studentName || '').trim()
    const roster = getStudents()
    const inRoster = roster.some((s) => s.name === studentName)
    if (!studentName || !inRoster) {
      wx.showToast({ title: '请从名单中选择学生', icon: 'none' })
      return
    }
    if (!startTime) {
      wx.showToast({ title: '请选择开始时间', icon: 'none' })
      return
    }

    if (!isEdit && !skipRepeatSameDayCheck) {
      const sameDayCount = getCourses().filter((c) => c.date === date && c.studentName === studentName).length
      if (sameDayCount >= 1) {
        this.setData({
          modalShow: true,
          modalTitle: '今日已上过课',
          modalContent: `学生「${studentName}」今天已经排过 ${sameDayCount} 节课，是否继续排课？`,
          modalShowCancel: true,
          modalType: 'repeat_same_day',
          modalConfirmText: '继续排课',
          modalCancelText: '取消',
        })
        return
      }
    }

    // 时间片冲突检测（编辑时排除自身）；新增时视为「插入课程」：新课占所选时刻，原课顺延
    if (hasConflict(date, startTime, duration, isEdit ? id : undefined)) {
      this.setData({
        modalShow: true,
        modalTitle: isEdit ? '时间冲突' : '插入课程',
        modalContent: isEdit
          ? '该时间段与已有课程重叠。确定后将保存修改，并顺延当日排在后面的课程。'
          : '该时段与已有课表重叠。将以「插入」方式保存：新课程占用所选开始时间，该时刻及之后的原有课程依次后移。',
        modalShowCancel: true,
        modalType: 'conflict',
      })
      return
    }

    if (isEdit && id) {
      const old = getCourses().find((c) => c.id === id)
      if (old) {
        const oldStart = timeToMinutes(old.startTime)
        const newStart = timeToMinutes(startTime)
        const movedEarlier = newStart < oldStart
        const restorableCount = movedEarlier ? getRestorableShiftCount(id) : 0
        if (restorableCount > 0) {
          this.setData({
            modalShow: true,
            modalTitle: '检测到可恢复顺延',
            modalContent: `该课程提前后，有 ${restorableCount} 节后续课程可恢复到顺延前时间，是否恢复？`,
            modalShowCancel: true,
            modalType: 'restore_shift',
            modalConfirmText: '是的',
            modalCancelText: '不用',
          })
          return
        }
      }
    }

    this.doSave(false, false)
  },

  /**
   * 保存：若是编辑且时间/时长变更，则执行自动顺延
   */
  /**
   * 最终保存执行器。
   * - forceShift: 冲突确认后强制走顺延路径
   * - restoreFollowers: 课程提前时，是否恢复历史被顺延的后续课程
   */
  doSave(forceShift: boolean, restoreFollowers: boolean) {
    const { id, date, startTime, duration, studentColor, reminderMinutes, isEdit } = this.data
    const note = String(this.data.note || '').trim()
    const studentName = String(this.data.studentName || '').trim()
    if (!getStudents().some((s) => s.name === studentName)) {
      wx.showToast({ title: '所选学生无效，请重新选择', icon: 'none' })
      return
    }
    const all = getCourses()

    if (isEdit && id) {
      const old = all.find((c) => c.id === id)!
      const timeOrDurChanged = old.startTime !== startTime || old.duration !== duration
      if (timeOrDurChanged || forceShift) {
        if (restoreFollowers) {
          // 课程提前后，按确认结果恢复此前被它顺延的后续课程
          restoreShiftedFollowersAfterUpdate(id, startTime, duration)
        } else {
          // 【核心】自动顺延：修改该课程后，当日排在其后的课程自动顺延
          autoShiftAfterUpdate(id, startTime, duration)
        }
      }
      // 更新当前课程的学生名、提醒、备注等（顺延已写回 storage）
      const current = getCourses().map((c) =>
        c.id === id ? { ...c, startTime, duration, studentName, studentColor: studentColor || c.studentColor, reminderMinutes, note: note || undefined } : c
      )
      setCourses(current)
    } else {
      // 新增：插入并可能顺延
      const added = insertCourseAndShift(date, startTime, duration, studentName, studentColor || undefined)
      if (reminderMinutes > 0 || note) {
        const list = getCourses().map((c) => (c.id === added.id ? { ...c, reminderMinutes, note: note || undefined } : c))
        setCourses(list)
      }
    }

    // 单价仅在「学生名单」维护；此处只同步本页选的区分色与默认时长参考，不写回 pricePerClass
    this.upsertStudentProfile(studentName, studentColor || undefined, duration)

    // 保存后立刻静默备份，降低老师忘记手动备份的风险
    void backupCurrentUserToCloud()
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },

  onDelete() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const { isFinished } = this.data
    this.setData({
      modalShow: true,
      modalTitle: isFinished ? '删除课程' : '取消课程',
      modalContent: isFinished
        ? '该课程已结束，是否确定删除？'
        : '该课程还没结束，是否确定取消？',
      modalShowCancel: true,
      modalType: 'delete',
    })
  },

  onModalConfirm() {
    playTouchSound()
    const { modalType, id, date, startTime, duration } = this.data
    if (isBossUser() && !isBossViewingSelf()) {
      // boss 只读：关闭弹窗但不执行任何保存/删除/顺延逻辑
      this.setData({
        modalShow: false,
        modalTitle: '',
        modalContent: '',
        modalShowCancel: true,
        modalType: '',
        modalConfirmText: '确定',
        modalCancelText: '取消',
      })
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    this.setData({
      modalShow: false,
      modalTitle: '',
      modalContent: '',
      modalShowCancel: true,
      modalType: '',
      modalConfirmText: '确定',
      modalCancelText: '取消',
    })
    if (modalType === 'repeat_same_day') this.trySave(true)
    if (modalType === 'conflict') this.doSave(true, false)
    if (modalType === 'restore_shift') this.doSave(false, true)
    if (modalType === 'delete') {
      const finished = isCourseFinished(date, startTime, duration)
      const doRemove = () => {
        const all = getCourses().filter((c) => c.id !== id)
        setCourses(all)
        void backupCurrentUserToCloud()
        wx.showToast({ title: finished ? '已删除' : '已取消', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
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
    }
  },

  onModalCancel() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      // boss 只读：只需关闭弹窗即可
      this.setData({
        modalShow: false,
        modalTitle: '',
        modalContent: '',
        modalShowCancel: true,
        modalType: '',
        modalConfirmText: '确定',
        modalCancelText: '取消',
      })
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    if (this.data.modalType === 'restore_shift') {
      this.setData({
        modalShow: false,
        modalTitle: '',
        modalContent: '',
        modalShowCancel: true,
        modalType: '',
        modalConfirmText: '确定',
        modalCancelText: '取消',
      })
      this.doSave(false, false)
      return
    }
    this.setData({
      modalShow: false,
      modalTitle: '',
      modalContent: '',
      modalShowCancel: true,
      modalType: '',
      modalConfirmText: '确定',
      modalCancelText: '取消',
    })
  },

  onCopyToOtherDate(e: WechatMiniprogram.PickerChange) {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const targetDate = e.detail.value as string
    const { startTime, duration, studentColor } = this.data
    const studentName = String(this.data.studentName || '').trim()
    if (!targetDate || !studentName || !getStudents().some((s) => s.name === studentName)) {
      if (targetDate && !studentName) wx.showToast({ title: '请先选择学生', icon: 'none' })
      return
    }
    // 插入到目标日期并自动顺延，避免重叠
    const added = insertCourseAndShift(targetDate, startTime, duration, studentName, studentColor || undefined)
    wx.showToast({ title: '已复制到 ' + targetDate, icon: 'success' })
  },

  /**
   * 将本课选用的区分色、默认时长参考回写名单；单价不在排课页修改。
   */
  upsertStudentProfile(name: string, color?: string, defaultDurationHint?: number) {
    if (!name) return
    const students = getStudents()
    const idx = students.findIndex((s) => s.name === name)
    if (idx < 0) return
    const current = students[idx]
    const next: Student = {
      ...current,
      name,
      color: color || current.color,
      defaultDuration: current.defaultDuration ?? defaultDurationHint,
    }
    students[idx] = next
    setStudents(students)
  },
})
