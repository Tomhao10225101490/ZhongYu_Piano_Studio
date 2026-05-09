import { canSyncToBackupServer } from '../../utils/auth'
import { backupCurrentUserToCloud } from '../../utils/cloud'
import { getCourses, getStudents, nextId, setStudents } from '../../utils/storage'
import { playTouchSound } from '../../utils/sound'
import type { Student } from '../../types/index'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'

interface StudentPriceItem {
  id: string
  name: string
  priceInput: string
}

Page({
  data: {
    allItems: [] as StudentPriceItem[],
    items: [] as StudentPriceItem[],
    onlyUnset: false,
    totalCount: 0,
    unsetCount: 0,
    hint: '填写后将按该学生单价计算统计，留空则使用全局单价',
  },

  onLoad() {
    wx.redirectTo({ url: '/pages/students/students' })
  },

  onShow() {},

  buildItems() {
    const students = getStudents()
    const courses = getCourses()
    const nameSet = new Set<string>()
    const baseMap = new Map<string, Student>()

    students.forEach((s) => {
      const name = (s.name || '').trim()
      if (!name) return
      nameSet.add(name)
      baseMap.set(name, s)
    })
    courses.forEach((c) => {
      const name = (c.studentName || '').trim()
      if (!name) return
      nameSet.add(name)
    })

    const names = Array.from(nameSet).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const allItems: StudentPriceItem[] = names.map((name) => {
      const student = baseMap.get(name)
      const price = student?.pricePerClass
      return {
        id: student?.id || nextId(),
        name,
        priceInput: Number.isFinite(price) && (price as number) > 0 ? String(price) : '',
      }
    })
    this.setData({
      allItems,
      totalCount: allItems.length,
      unsetCount: allItems.filter((item) => !item.priceInput).length,
    })
    this.applyFilter()
  },

  onPriceInput(e: WechatMiniprogram.CustomEvent) {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const v = String(e.detail.value || '').replace(/[^\d.]/g, '')
    const allItems = this.data.allItems.map((item) => (item.id === id ? { ...item, priceInput: v } : item))
    this.setData({
      allItems,
      unsetCount: allItems.filter((item) => !item.priceInput).length,
    })
    this.applyFilter()
  },

  onToggleOnlyUnset() {
    playTouchSound()
    this.setData({ onlyUnset: !this.data.onlyUnset })
    this.applyFilter()
  },

  applyFilter() {
    const items = this.data.onlyUnset
      ? this.data.allItems.filter((item) => !item.priceInput)
      : this.data.allItems
    this.setData({ items })
  },

  async onConfirmSave() {
    playTouchSound()
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const existing = getStudents()
    const byName = new Map<string, Student>()
    existing.forEach((s) => {
      const name = (s.name || '').trim()
      if (name) byName.set(name, s)
    })

    const next: Student[] = this.data.allItems.map((item) => {
      const old = byName.get(item.name)
      const parsed = Number(item.priceInput)
      const hasPrice = Number.isFinite(parsed) && parsed > 0
      return {
        id: old?.id || item.id || nextId(),
        name: item.name,
        defaultDuration: old?.defaultDuration,
        color: old?.color,
        pricePerClass: hasPrice ? parsed : undefined,
      }
    })
    setStudents(next)

    const canCloud = canSyncToBackupServer()
    wx.showLoading({ title: canCloud ? '保存并备份中…' : '保存中…' })
    try {
      const ok = canCloud ? await backupCurrentUserToCloud() : false
      wx.hideLoading()
      if (ok) {
        wx.showToast({ title: '学生单价已保存并同步', icon: 'success' })
      } else if (canCloud) {
        wx.showToast({ title: '已保存（云同步未完成）', icon: 'none' })
      } else {
        wx.showToast({ title: '学生单价已保存', icon: 'success' })
      }
    } catch {
      wx.hideLoading()
      wx.showToast({ title: canCloud ? '已保存（云同步失败）' : '学生单价已保存', icon: 'none' })
    }
  },
})

