/**
 * 全局页面底层背景：读取 settings 中的背景图；无图时用默认渐变
 * UTF-8
 */

import { getSettings } from '../../utils/storage'
import { getWindowInfoCompat } from '../../utils/env'

Component({
  data: {
    displaySrc: '' as string,
    tone: 'light' as 'light' | 'dark',
  },

  lifetimes: {
    attached() {
      this.refreshFromStorage()
    },
  },

  pageLifetimes: {
    show() {
      this.refreshFromStorage()
    },
  },

  methods: {
    /** 供设置页上传后立即刷新 */
    refresh() {
      this.refreshFromStorage()
    },

    refreshFromStorage() {
      const s = getSettings()
      const url = (s.backgroundImageUrl || '').trim()
      const local = (s.backgroundImageLocalPath || '').trim()
      const src = url || local
      this.setData({
        displaySrc: src,
        tone: 'light',
      })
    },

    onImgLoad() {
      const src = this.data.displaySrc
      if (!src) return
      const query = wx.createSelectorQuery().in(this)
      query
        .select('#appBgCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res?.[0]?.node as WechatMiniprogram.Canvas | undefined
          if (!canvas) return
          const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
          if (!ctx) return
          const createImage = (canvas as unknown as { createImage?: () => WechatMiniprogram.Image }).createImage
          if (!createImage) {
            this.setData({ tone: 'light' })
            return
          }
          const dpr = getWindowInfoCompat().pixelRatio || 1
          const side = 32
          canvas.width = side * dpr
          canvas.height = side * dpr
          ctx.scale(dpr, dpr)
          const img = createImage.call(canvas)
          img.onload = () => {
            try {
              ctx.drawImage(img, 0, 0, side, side)
              const imageData = ctx.getImageData(0, 0, side, side)
              const data = imageData.data
              let sum = 0
              const n = data.length / 4
              for (let i = 0; i < data.length; i += 4) {
                sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
              }
              const avg = sum / n
              this.setData({ tone: avg < 125 ? 'dark' : 'light' })
            } catch (_) {
              this.setData({ tone: 'light' })
            }
          }
          img.onerror = () => {
            this.setData({ tone: 'light' })
          }
          img.src = src
        })
    },
  },
})
