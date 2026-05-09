import {
  clearRestoreSnapshot,
  getCourses,
  getRestoreSnapshot,
  getSettings,
  getStudents,
  getStudioExpenses,
  setCourses,
  setRestoreSnapshot,
  setSettings,
  setStudents,
  setStudioExpenses,
} from '../../utils/storage'
import { getValidAuthToken } from '../../utils/auth'
import { BACKUP_SERVER_URL, getBackupServerBase } from '../../utils/server'
import type { AppSettings, Course, Student, StudioExpense } from '../../types/index'
import { getBossReadOnlyHint, isBossUser, isBossViewingSelf } from '../../utils/boss'
import { backupCurrentUserToCloud } from '../../utils/cloud'

interface RestoreResponse {
  success?: boolean
  message?: string
  backupAt?: string
  courses?: Course[]
  students?: Student[]
  settings?: AppSettings
  studioExpenses?: StudioExpense[]
}

Page({
  data: {
    backupText: '',
    backupServerUrl: BACKUP_SERVER_URL,
    undoHint: '',
    isBoss: false,
  },

  onLoad() {
    this.setData({ backupServerUrl: BACKUP_SERVER_URL })
    this.setData({ isBoss: isBossUser() })
    this.syncUndoHint()
  },

  onShow() {
    this.setData({ backupServerUrl: BACKUP_SERVER_URL })
    this.setData({ isBoss: isBossUser() })
    this.syncUndoHint()
  },

  syncUndoHint() {
    const snapshot = getRestoreSnapshot()
    if (!snapshot?.snapshotAt) {
      this.setData({ undoHint: '' })
      return
    }
    const at = snapshot.snapshotAt.replace('T', ' ').slice(0, 19)
    this.setData({ undoHint: `可撤销快照时间：${at}` })
  },

  onBackup() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const courses = getCourses()
    this.setData({ backupText: JSON.stringify(courses, null, 2) })
    wx.showToast({ title: '已生成', icon: 'success' })
  },

  onCopyBackup() {
    wx.setClipboardData({ data: this.data.backupText as string })
    wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
  },

  onBackupToServer() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    wx.showLoading({ title: '上传中…' })
    void backupCurrentUserToCloud().then((ok) => {
      wx.hideLoading()
      if (ok) {
        wx.showToast({ title: '备份已上传', icon: 'success' })
      } else {
        const hasToken = !!getValidAuthToken()
        wx.showToast({ title: hasToken ? '备份失败，请检查网络' : '请先在个人页登录账号', icon: 'none' })
      }
    })
  },

  onRestoreLatestBackup() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const url = getBackupServerBase()
    const token = getValidAuthToken()
    if (!token) {
      wx.showToast({ title: '请先在个人页登录账号', icon: 'none' })
      return
    }
    wx.showModal({
      title: '从云端恢复',
      content: '将覆盖当前账号本机数据（课程、学生、设置、工作室支出），是否继续？',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        const snapshotCourses = getCourses()
        const snapshotStudents = getStudents()
        const snapshotSettings = getSettings()
        const snapshotStudioExpenses = getStudioExpenses()
        wx.showLoading({ title: '恢复中…' })
        wx.request({
          url: url + '/api/backup/latest',
          method: 'GET',
          header: { Authorization: 'Bearer ' + token },
          success: (res) => {
            wx.hideLoading()
            const data = (res.data || {}) as RestoreResponse
            if (!data.success) {
              wx.showToast({ title: data.message || '恢复失败', icon: 'none' })
              return
            }
            setRestoreSnapshot({
              courses: snapshotCourses,
              students: snapshotStudents,
              settings: snapshotSettings,
              studioExpenses: snapshotStudioExpenses,
              snapshotAt: new Date().toISOString(),
            })
            setCourses(Array.isArray(data.courses) ? data.courses : [])
            setStudents(Array.isArray(data.students) ? data.students : [])
            setSettings(data.settings && typeof data.settings === 'object' ? data.settings : ({} as AppSettings))
            if (Array.isArray(data.studioExpenses)) {
              setStudioExpenses(data.studioExpenses)
            } else {
              setStudioExpenses([])
            }
            this.syncUndoHint()
            wx.showToast({ title: '恢复成功', icon: 'success' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误，请检查地址与域名', icon: 'none' })
          },
        })
      },
    })
  },

  onUndoLastRestore() {
    if (isBossUser() && !isBossViewingSelf()) {
      wx.showToast({ title: getBossReadOnlyHint(), icon: 'none' })
      return
    }
    const snapshot = getRestoreSnapshot()
    if (!snapshot) {
      wx.showToast({ title: '暂无可撤销快照', icon: 'none' })
      return
    }
    wx.showModal({
      title: '撤销上次恢复',
      content: '将回滚到恢复前快照，是否继续？',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        setCourses(snapshot.courses)
        setStudents(snapshot.students)
        setSettings(snapshot.settings)
        setStudioExpenses(Array.isArray(snapshot.studioExpenses) ? snapshot.studioExpenses : [])
        clearRestoreSnapshot()
        this.syncUndoHint()
        wx.showToast({ title: '已撤销恢复', icon: 'success' })
      },
    })
  },
})

