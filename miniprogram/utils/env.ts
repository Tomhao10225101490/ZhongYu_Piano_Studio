/**
 * 微信基础库 / iOS Android 差异兼容：旧版无新 API 时回退，避免真机白屏或手势异常
 * UTF-8
 */

/** 与 wx.getWindowInfo 返回值中本项目中用到的字段对齐 */
export type WindowInfoCompat = {
  windowWidth: number
  windowHeight: number
  pixelRatio: number
}

const FALLBACK: WindowInfoCompat = {
  windowWidth: 375,
  windowHeight: 667,
  pixelRatio: 2,
}

/**
 * 替代 wx.getWindowInfo()：2.20.1+ 才有 getWindowInfo，旧库统一用 getSystemInfoSync
 * @see https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html
 */
export function getWindowInfoCompat(): WindowInfoCompat {
  const w = wx as WechatMiniprogram.Wx & {
    getWindowInfo?: () => WindowInfoCompat
  }
  if (typeof w.getWindowInfo === 'function') {
    try {
      const o = w.getWindowInfo()
      if (o && typeof o.windowWidth === 'number' && o.windowWidth > 0) {
        return {
          windowWidth: o.windowWidth,
          windowHeight: typeof o.windowHeight === 'number' && o.windowHeight > 0 ? o.windowHeight : FALLBACK.windowHeight,
          pixelRatio: typeof o.pixelRatio === 'number' && o.pixelRatio > 0 ? o.pixelRatio : FALLBACK.pixelRatio,
        }
      }
    } catch {
      // ignore
    }
  }
  try {
    const sys = wx.getSystemInfoSync()
    const ww = Number(sys.windowWidth) || Number(sys.screenWidth) || FALLBACK.windowWidth
    const wh = Number(sys.windowHeight) || Number(sys.screenHeight) || FALLBACK.windowHeight
    const pr = Number(sys.pixelRatio) > 0 ? Number(sys.pixelRatio) : FALLBACK.pixelRatio
    return { windowWidth: ww, windowHeight: wh, pixelRatio: pr }
  } catch {
    return { ...FALLBACK }
  }
}

function canUseVibrateType(): boolean {
  try {
    return typeof wx.canIUse === 'function' && wx.canIUse('vibrateShort.object.type')
  } catch {
    return false
  }
}

/**
 * 短震动：旧基础库不支持 type 字段，降级为无参调用
 */
export function vibrateShortCompat(kind: 'light' | 'medium' = 'light'): void {
  try {
    if (canUseVibrateType()) {
      wx.vibrateShort({ type: kind })
      return
    }
    wx.vibrateShort({})
  } catch {
    try {
      wx.vibrateShort({})
    } catch {
      // 设备不支持或 API 不可用
    }
  }
}
