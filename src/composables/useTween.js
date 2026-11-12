/**
 * 数字补间：目标值变化时，显示值在 duration 毫秒内平滑过渡过去（缓出）
 * 用法：const shown = useTween(() => speed.up)，模板里 formatSpeed(shown)
 * 动画关闭或页面在后台时直接跳到目标值
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { motionEnabled } from '@/utils/motion'

const easeOut = (t) => 1 - (1 - t) ** 3

export function useTween(source, { duration = 600 } = {}) {
  const value = ref(Number(source()) || 0)
  let raf = 0

  watch(source, (to) => {
    to = Number(to) || 0
    cancelAnimationFrame(raf)
    const from = value.value
    if (!motionEnabled() || document.hidden || from === to) {
      value.value = to
      return
    }
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      value.value = from + (to - from) * easeOut(t)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })

  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return value
}
