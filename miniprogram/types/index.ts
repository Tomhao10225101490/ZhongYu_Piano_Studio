/**
 * 钟于钢琴工作室 - 数据类型定义
 * UTF-8
 */

/** 单节课程（时间片） */
export interface Course {
  id: string
  /** 日期 YYYY-MM-DD */
  date: string
  /** 开始时间 HH:mm */
  startTime: string
  /** 时长（分钟） */
  duration: number
  /** 学生姓名 */
  studentName: string
  /** 学生区分色（莫兰迪色 hex） */
  studentColor?: string
  /** 上课提醒：提前分钟数，0 表示不提醒 */
  reminderMinutes?: number
  /** 备注 */
  note?: string
  /** 因冲突顺延前的原始开始时间（用于后续恢复） */
  preShiftStartTime?: string
  /** 导致本课被顺延的课程 ID */
  shiftedByCourseId?: string
}

/** 学生信息（可选，用于默认时长和颜色） */
export interface Student {
  id: string
  name: string
  /** 该学生默认课时长（分钟） */
  defaultDuration?: number
  /** 莫兰迪色 */
  color?: string
  /** 该学生课时单价（元/45分钟） */
  pricePerClass?: number
  /** 该学生给老板分成比例（0-100）；未设置则走全局默认 */
  bossSharePercent?: number
}

/** 工作室固定支出（按月记账，如房租） */
export interface StudioExpense {
  id: string
  /** 归属月份 YYYY-MM */
  yearMonth: string
  /** 金额（元） */
  amount: number
  /** 说明，如「房租」 */
  note?: string
  /** 创建时间 ISO（可选） */
  createdAt?: string
}

/** 全局设置 */
export interface AppSettings {
  /** 单节课单价（元） */
  pricePerClass?: number
  /** 默认课时长（分钟） */
  defaultDuration?: number
  /** 默认上课提醒提前分钟数 */
  defaultReminderMinutes?: number
  /** 老板分成比例（0-100），教师所得 = 100% - 该比例 */
  bossSharePercent?: number
  /** 音效开关：点击按钮时是否播放 touch_sound */
  soundEnabled?: boolean
  /** 分享范围：full=完整课表, endTimeOnly=仅显示下课时间 */
  shareScope?: 'full' | 'endTimeOnly'
  /** 备份服务器根地址（如 https://backup.xxx.com，不要带 /api/backup） */
  backupServerUrl?: string
  /** 自定义页面背景图（HTTPS，登录后备份同步） */
  backgroundImageUrl?: string
  /** 本机持久路径（游客或未上传云端时），不同设备无效 */
  backgroundImageLocalPath?: string
  /** 老板认证是否已通过（用于跨设备恢复） */
  bossCertified?: boolean
  /** 老板上次查看的老师的 openid（与本人相同时表示查看自己） */
  bossLastViewOwnerKey?: string
}

/** 登录态（用于绑定服务器侧用户） */
export interface AuthState {
  /** 微信用户唯一标识（由服务端 code2session 获得） */
  openid: string
  /** 服务端签发的备份接口令牌 */
  authToken: string
  /** 令牌过期时间（毫秒时间戳） */
  expiresAt: number
}

/** 恢复前的本地快照（用于撤销） */
export interface RestoreSnapshot {
  courses: Course[]
  students: Student[]
  settings: AppSettings
  studioExpenses?: StudioExpense[]
  snapshotAt: string
}

/** 微信用户资料（来自 wx.getUserProfile） */
export interface UserProfileInfo {
  nickName: string
  avatarUrl: string
  gender?: number
  country?: string
  province?: string
  city?: string
  language?: string
  updatedAt: string
}
