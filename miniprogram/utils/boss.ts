import { getBossStatus, getBossViewIsSelf } from './storage'

/** 当前账号是否为老板（本地缓存口令认证） */
export function isBossUser(): boolean {
  return getBossStatus()
}

/** 老板当前正在查看自己的数据 */
export function isBossViewingSelf(): boolean {
  return getBossViewIsSelf()
}

/** 老板当前正在查看别的老师的数据 */
export function isBossViewingOther(): boolean {
  return isBossUser() && !isBossViewingSelf()
}

/** 统一提示文案（老板只读；工作室支出页除外，见该页说明） */
export function getBossReadOnlyHint(): string {
  return '老板模式仅查看，不能排课或改课表/学生等数据。（工作室支出可在对应页面由老板维护）'
}

