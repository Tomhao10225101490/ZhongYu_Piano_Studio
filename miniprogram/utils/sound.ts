/**
 * 音效：点击按钮时播放，受设置页「音效」开关控制
 * UTF-8
 */

import { getSettings } from './storage'

const TOUCH_SOUND_PATH = '/sounds/touch_sound.mp3'

let audioContext: WechatMiniprogram.InnerAudioContext | null = null

function getAudio(): WechatMiniprogram.InnerAudioContext {
  if (!audioContext) {
    audioContext = wx.createInnerAudioContext()
    audioContext.src = TOUCH_SOUND_PATH
    audioContext.volume = 0.6
  }
  return audioContext
}

/**
 * 点击任意按钮时调用，若设置中开启音效则立即播放 touch_sound
 */
export function playTouchSound(): void {
  try {
    const settings = getSettings()
    if (settings.soundEnabled !== true) return
    const ctx = getAudio()
    ctx.seek(0)
    ctx.play()
  } catch (_) {}
}
