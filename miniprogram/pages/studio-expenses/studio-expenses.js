/**
 * 工作室固定支出（与 studio-expenses.ts 逻辑一致）
 */
const { getStudioExpenses, setStudioExpenses, nextId } = require('../../utils/storage')
const { drainPendingCloudBackup, syncStudioExpensesAfterLocalChange } = require('../../utils/cloud')
const { refreshBossViewingTeacherFromCloud } = require('../../utils/bossSwitch')
const { playTouchSound } = require('../../utils/sound')
const {
  isValidYearMonth,
  expenseYear,
  sumStudioExpensesForCalendarYear,
  sumStudioExpensesForYearMonth,
} = require('../../utils/studioExpenseStats')
const { isBossUser, isBossViewingSelf } = require('../../utils/boss')
const { hardRequireProfileSetup } = require('../../utils/profileEnforce')

function padYmFromDatePick(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : s
}

function formatMonthDisplay(ym) {
  if (!isValidYearMonth(ym)) return ym
  const parts = ym.split('-')
  const y = parts[0]
  const mo = parts[1]
  return `${y} 年 ${Number(mo)} 月`
}

function sortExpenses(items) {
  return items.slice().sort((a, b) => {
    const c = (b.yearMonth || '').localeCompare(a.yearMonth || '')
    if (c !== 0) return c
    return (b.id || '').localeCompare(a.id || '')
  })
}

function toItemRow(e) {
  return {
    ...e,
    yearMonthDisplay: formatMonthDisplay(e.yearMonth),
    noteLine: (e.note || '').trim() || '（无说明）',
    amountDisplay: Number(e.amount).toFixed(2),
  }
}

function buildMonthGroups(filtered) {
  const sorted = sortExpenses(filtered)
  const map = new Map()
  for (const e of sorted) {
    const k = e.yearMonth
    const arr = map.get(k) || []
    arr.push(e)
    map.set(k, arr)
  }
  const keys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a))
  return keys.map((ym) => {
    const items = map.get(ym) || []
    const sub = sumStudioExpensesForYearMonth(sorted, ym)
    return {
      yearMonth: ym,
      yearMonthDisplay: formatMonthDisplay(ym),
      monthSubtotal: sub.toFixed(2),
      itemCount: items.length,
      items: items.map(toItemRow),
    }
  })
}

function collectFilterYears(all) {
  const set = new Set()
  for (const e of all) {
    const y = expenseYear(e.yearMonth)
    if (y != null) set.add(y)
  }
  return Array.from(set).sort((a, b) => b - a)
}

function matchesSearch(e, q) {
  if (!q) return true
  const note = (e.note || '').toLowerCase()
  const ym = (e.yearMonth || '').toLowerCase()
  const disp = formatMonthDisplay(e.yearMonth).toLowerCase()
  return note.includes(q) || ym.includes(q) || disp.includes(q)
}

function runAfterStudioExpenseSyncToast() {
  void syncStudioExpensesAfterLocalChange().then((ok) => {
    if (!ok && isBossUser() && !isBossViewingSelf()) {
      wx.showToast({
        title: '本机已更新；云端同步失败，请检查网络与老师备份',
        icon: 'none',
        duration: 2800,
      })
    }
  })
}

Page({
  data: {
    monthGroups: [],
    showForm: false,
    formTitle: '添加支出',
    formYearMonth: '',
    formAmount: '',
    formNote: '',
    editingId: '',
    isBoss: false,
    viewingOtherHint: '',

    hasAnyInStorage: false,
    summaryMain: '',
    summarySub: '',
    searchQuery: '',
    filterLabels: ['全部'],
    filterValues: [-1],
    filterYearIndex: 0,
  },

  onLoad() {
    this.syncBossUi()
    this.loadList()
  },

  onShow() {
    if (hardRequireProfileSetup()) return
    this.syncBossUi()
    this.loadList()
    if (isBossUser() && !isBossViewingSelf()) {
      if (refreshBossViewingTeacherFromCloud) {
        refreshBossViewingTeacherFromCloud().then((changed) => {
          if (changed) {
            this.syncBossUi()
            this.loadList()
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
          this.syncBossUi()
          this.loadList()
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

  syncBossUi() {
    const isBoss = isBossUser()
    const viewingOther = isBoss && !isBossViewingSelf()
    this.setData({
      isBoss,
      viewingOtherHint: viewingOther
        ? '您正在查看其他老师：可在此维护对方「工作室支出」（会尝试同步到该老师云端备份）。课表、学生名单等请在对应页面只读查看。'
        : '',
    })
  },

  loadList() {
    const all = getStudioExpenses()
    const years = collectFilterYears(all)
    const filterLabels = ['全部', ...years.map((y) => `${y} 年`)]
    const filterValues = [-1, ...years]

    let filterYearIndex = Number(this.data.filterYearIndex) || 0
    if (filterYearIndex >= filterLabels.length) filterYearIndex = 0

    const fy = filterValues[filterYearIndex] ?? -1
    const q = String(this.data.searchQuery || '')
      .trim()
      .toLowerCase()

    let filtered = all
    if (fy >= 2000) {
      filtered = filtered.filter((e) => expenseYear(e.yearMonth) === fy)
    }
    filtered = filtered.filter((e) => matchesSearch(e, q))

    const monthGroups = buildMonthGroups(filtered)
    const now = new Date()
    const cy = now.getFullYear()
    const totalCount = all.length
    const listFilteredCount = filtered.length

    let summaryMain = ''
    let summarySub = ''
    if (totalCount === 0) {
      summaryMain = '暂无支出记录'
    } else if (fy < 0) {
      const ysum = sumStudioExpensesForCalendarYear(all, cy)
      summaryMain = `库中共 ${totalCount} 笔 · ${cy} 年合计 ¥${ysum.toFixed(2)}`
      if (listFilteredCount !== totalCount) {
        summarySub = `当前列表 ${listFilteredCount} 笔（已筛选）`
      }
    } else {
      const ysum = sumStudioExpensesForCalendarYear(all, fy)
      const yrCount = all.filter((e) => expenseYear(e.yearMonth) === fy).length
      summaryMain = `${fy} 年合计 ¥${ysum.toFixed(2)} · 列表 ${listFilteredCount} 笔`
      if (q && listFilteredCount < yrCount) {
        summarySub = `该年库中共 ${yrCount} 笔`
      }
    }

    this.setData({
      hasAnyInStorage: totalCount > 0,
      filterLabels,
      filterValues,
      filterYearIndex,
      monthGroups,
      summaryMain,
      summarySub,
    })
  },

  onFilterYearPick(e) {
    playTouchSound()
    const idx = Number(e.detail.value)
    if (!Number.isFinite(idx) || idx < 0) return
    this.setData({ filterYearIndex: idx })
    this.loadList()
  },

  onSearchInput(e) {
    this.setData({ searchQuery: e.detail.value || '' })
    this.loadList()
  },

  onClearSearch() {
    playTouchSound()
    this.setData({ searchQuery: '' })
    this.loadList()
  },

  onCopySummary() {
    playTouchSound()
    const groups = this.data.monthGroups
    const labels = this.data.filterLabels
    const idx = Number(this.data.filterYearIndex) || 0
    const scope = labels[idx] || '全部'
    const q = String(this.data.searchQuery || '').trim()

    if (!groups.length) {
      wx.showToast({ title: '没有可复制的内容', icon: 'none' })
      return
    }
    const lines = ['【工作室支出清单】', `范围：${scope}${q ? ` · 搜索「${q}」` : ''}`, '']
    let n = 0
    for (const g of groups) {
      lines.push(`${g.yearMonthDisplay} · ${g.itemCount} 笔 · 小计 ¥${g.monthSubtotal}`)
      for (const it of g.items) {
        lines.push(`  · ${it.noteLine}  ¥${it.amountDisplay}`)
        n += 1
      }
      lines.push('')
    }
    lines.push(`— 以上共 ${n} 条 —`)
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    })
  },

  onAdd() {
    playTouchSound()
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    this.setData({
      showForm: true,
      formTitle: '添加支出',
      formYearMonth: ym,
      formAmount: '',
      formNote: '',
      editingId: '',
    })
  },

  onEdit(e) {
    playTouchSound()
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const ex = getStudioExpenses().find((x) => x.id === id)
    if (!ex) return
    this.setData({
      showForm: true,
      formTitle: '编辑支出',
      formYearMonth: ex.yearMonth,
      formAmount: ex.amount > 0 ? String(ex.amount) : '',
      formNote: ex.note || '',
      editingId: id,
    })
  },

  onCloseForm() {
    playTouchSound()
    this.setData({ showForm: false })
  },

  noop() {},

  onFillFromRecent() {
    playTouchSound()
    const sorted = sortExpenses(getStudioExpenses())
    if (!sorted.length) {
      wx.showToast({ title: '暂无历史记录', icon: 'none' })
      return
    }
    const top = sorted[0]
    this.setData({
      formAmount: top.amount > 0 ? String(top.amount) : '',
      formNote: top.note || '',
    })
    wx.showToast({ title: '已填入最近一笔', icon: 'none' })
  },

  onFormMonthChange(e) {
    const ym = padYmFromDatePick(String(e.detail.value || ''))
    if (ym) this.setData({ formYearMonth: ym })
  },

  onFormAmountInput(e) {
    this.setData({ formAmount: e.detail.value || '' })
  },

  onFormNoteInput(e) {
    this.setData({ formNote: e.detail.value || '' })
  },

  onSave() {
    playTouchSound()
    const ym = String(this.data.formYearMonth || '').trim()
    if (!isValidYearMonth(ym)) {
      wx.showToast({ title: '请选择有效月份', icon: 'none' })
      return
    }
    const amtRaw = Number(String(this.data.formAmount || '').trim())
    if (!Number.isFinite(amtRaw) || amtRaw <= 0) {
      wx.showToast({ title: '请输入大于 0 的金额', icon: 'none' })
      return
    }
    if (amtRaw > 99999999) {
      wx.showToast({ title: '金额过大，请核对', icon: 'none' })
      return
    }
    const note = String(this.data.formNote || '').trim()
    const editingId = String(this.data.editingId || '').trim()
    const all = getStudioExpenses()

    if (editingId) {
      const next = all.map((x) =>
        x.id === editingId
          ? { ...x, yearMonth: ym, amount: Math.round(amtRaw * 100) / 100, note: note || undefined }
          : x,
      )
      setStudioExpenses(next)
    } else {
      const created = {
        id: nextId(),
        yearMonth: ym,
        amount: Math.round(amtRaw * 100) / 100,
        note: note || undefined,
        createdAt: new Date().toISOString(),
      }
      setStudioExpenses([...all, created])
    }

    this.setData({ showForm: false })
    this.loadList()
    wx.showToast({ title: '已保存', icon: 'success' })
    runAfterStudioExpenseSyncToast()
  },

  onDelete() {
    playTouchSound()
    const editingId = String(this.data.editingId || '').trim()
    if (!editingId) return
    wx.showModal({
      title: '删除记录',
      content: '确定删除该条工作室支出？',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return
        const next = getStudioExpenses().filter((x) => x.id !== editingId)
        setStudioExpenses(next)
        this.setData({ showForm: false })
        this.loadList()
        wx.showToast({ title: '已删除', icon: 'success' })
        runAfterStudioExpenseSyncToast()
      },
    })
  },
})
