/**
 * 学生名单：增删改；姓名变更时同步当日历课程中的 studentName；数据与备份与既有 Student 一致
 * UTF-8
 */

import { getStudents, setStudents, getCourses, setCourses, nextId } from '../../utils/storage'
import { backupCurrentUserToCloud } from '../../utils/cloud'
import { playTouchSound } from '../../utils/sound'
import { STUDENT_COLORS } from '../../utils/constant'
import { filterStudentsByQuery } from '../../utils/studentSearch'
import type { Student } from '../../types/index'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'

const DURATIONS = [30, 45, 60, 90]

type Row = Student & { metaLine: string }

function formatStudentMeta(s: Student): string {
  const parts: string[] = []
  if (s.pricePerClass && s.pricePerClass > 0) parts.push(`${s.pricePerClass} 元/45分钟`)
  else parts.push('单价未设（统计用全局）')
  if (s.defaultDuration) parts.push(`默认 ${s.defaultDuration} 分钟`)
  if (typeof s.bossSharePercent === 'number' && Number.isFinite(s.bossSharePercent)) {
    const p = Math.min(100, Math.max(0, Math.floor(s.bossSharePercent)))
    parts.push(`老板分成 ${p}%`)
  } else {
    parts.push('分成走全局')
  }
  return parts.join(' · ')
}

function patchCoursesStudentName(oldName: string, newName: string): void {
  const o = oldName.trim()
  const n = newName.trim()
  if (!o || o === n) return
  const all = getCourses()
  let changed = false
  const next = all.map((c) => {
    if (c.studentName === o) {
      changed = true
      return { ...c, studentName: n }
    }
    return c
  })
  if (changed) setCourses(next)
}

Page({
  data: {
    list: [] as Row[],
    /** 名单总人数（用于空态与是否显示搜索） */
    hasAnyStudent: false,
    searchQuery: '',
    showForm: false,
    formTitle: '',
    editingId: '' as string,
    editingOriginalName: '' as string,
    formName: '',
    formPrice: '' as string,
    formBossSharePercent: '' as string,
    formDurationIndex: 1,
    durationOptions: DURATIONS,
    formColorIndex: 0,
    colorPickerRange: [] as { hex: string; label: string }[],
    isBoss: false,
  },

  onLoad() {
    this.setData({
      colorPickerRange: STUDENT_COLORS.map((hex, i) => ({
        hex,
        label: `色样 ${i + 1}（${hex}）`,
      })),
    })
    this.loadList()
  },

  onShow() {
    this.setData({ isBoss: isBossUser() })
    this.loadList()
  },

  noop() {},

  loadList(query?: string) {
    const q = query !== undefined ? query : this.data.searchQuery
    const roster = getStudents()
    const hasAnyStudent = roster.length > 0
    const filtered = filterStudentsByQuery(roster, q)
    const list: Row[] = filtered.map((s) => ({
      ...s,
      metaLine: formatStudentMeta(s),
    }))
    const patch: Record<string, unknown> = { list, hasAnyStudent }
    if (query !== undefined) patch.searchQuery = q
    this.setData(patch)
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.loadList(e.detail.value || '')
  },

  onAdd() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const di = Math.max(0, DURATIONS.indexOf(45))
    this.setData({
      showForm: true,
      formTitle: '添加学生',
      editingId: '',
      editingOriginalName: '',
      formName: '',
      formPrice: '',
      formBossSharePercent: '',
      formDurationIndex: di >= 0 ? di : 1,
      formColorIndex: 0,
    })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const s = getStudents().find((x) => x.id === id)
    if (!s) return
    const di = Math.max(0, DURATIONS.indexOf(s.defaultDuration ?? 45))
    const ci = Math.max(
      0,
      STUDENT_COLORS.indexOf(s.color || STUDENT_COLORS[0]),
    )
    this.setData({
      showForm: true,
      formTitle: '编辑学生',
      editingId: id,
      editingOriginalName: s.name,
      formName: s.name,
      formPrice:
        s.pricePerClass && s.pricePerClass > 0 ? String(s.pricePerClass) : '',
      formBossSharePercent:
        typeof s.bossSharePercent === 'number' && Number.isFinite(s.bossSharePercent)
          ? String(Math.min(100, Math.max(0, Math.floor(s.bossSharePercent))))
          : '',
      formDurationIndex: di >= 0 ? di : 1,
      formColorIndex: ci >= 0 ? ci : 0,
    })
  },

  onCloseForm() {
    playTouchSound()
    this.setData({ showForm: false })
  },

  onFormNameInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ formName: (e.detail.value as string) || '' })
  },

  onFormPriceInput(e: WechatMiniprogram.CustomEvent) {
    const v = (e.detail.value as string).replace(/[^\d.]/g, '')
    this.setData({ formPrice: v })
  },

  onFormBossSharePercentInput(e: WechatMiniprogram.CustomEvent) {
    const v = ((e.detail.value as string) || '').replace(/[^\d]/g, '')
    this.setData({ formBossSharePercent: v })
  },

  onFormDurationChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ formDurationIndex: Number(e.detail.value) })
  },

  onFormColorChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ formColorIndex: Number(e.detail.value) })
  },

  onSaveForm() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const {
      editingId,
      editingOriginalName,
      formName,
      formPrice,
      formBossSharePercent,
      formDurationIndex,
      formColorIndex,
    } = this.data
    const name = formName.trim()
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }

    const students = getStudents()
    const dup = students.find(
      (s) => s.name === name && (!editingId || s.id !== editingId),
    )
    if (dup) {
      wx.showToast({ title: '已有同名学生', icon: 'none' })
      return
    }

    const parsed = Number(formPrice)
    const hasPrice = Number.isFinite(parsed) && parsed > 0
    const rawBoss = Number(formBossSharePercent)
    const hasBossShare = formBossSharePercent !== '' && Number.isFinite(rawBoss)
    const bossSharePercent = hasBossShare ? Math.min(100, Math.max(0, Math.floor(rawBoss))) : undefined
    const hex = STUDENT_COLORS[formColorIndex] ?? STUDENT_COLORS[0]
    const duration = DURATIONS[formDurationIndex] ?? 45

    if (editingId) {
      const oldName = (editingOriginalName || '').trim()
      patchCoursesStudentName(oldName, name)
      const next = students.map((s) =>
        s.id === editingId
          ? {
              ...s,
              name,
              pricePerClass: hasPrice ? parsed : undefined,
              bossSharePercent,
              defaultDuration: duration,
              color: hex,
            }
          : s,
      )
      setStudents(next)
    } else {
      const created: Student = {
        id: nextId(),
        name,
        pricePerClass: hasPrice ? parsed : undefined,
        bossSharePercent,
        defaultDuration: duration,
        color: hex,
      }
      setStudents([...students, created])
    }

    this.setData({ showForm: false })
    this.loadList()
    void backupCurrentUserToCloud()
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  onDelete() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const { editingId, formName } = this.data
    if (!editingId) return
    wx.showModal({
      title: '删除学生',
      content: `确定从名单中移除「${formName}」？\n已有课程表中的姓名不会自动删除，仍可照常显示。`,
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return
        const next = getStudents().filter((s) => s.id !== editingId)
        setStudents(next)
        this.setData({ showForm: false })
        this.loadList()
        void backupCurrentUserToCloud()
        wx.showToast({ title: '已删除', icon: 'success' })
      },
    })
  },
})
