/**
 * iOS 风格弹窗组件：标题、内容、取消/确定；点击按钮时播放音效
 * UTF-8
 */
import { playTouchSound } from '../../utils/sound'

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    content: { type: String, value: '' },
    confirmText: { type: String, value: '确定' },
    cancelText: { type: String, value: '取消' },
    showCancel: { type: Boolean, value: true },
  },
  methods: {
    preventClose() {},
    onMaskTap() {
      playTouchSound()
      this.triggerEvent('cancel')
    },
    onCancel() {
      playTouchSound()
      this.triggerEvent('cancel')
    },
    onConfirm() {
      playTouchSound()
      this.triggerEvent('confirm')
    },
  },
})
