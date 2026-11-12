/**
 * 动画开关
 * - 用户在「配置 → 面板 → 动画效果」里设置，保存在 localStorage
 * - 没设置过时跟随系统：系统开启「减少动画」(prefers-reduced-motion) 就默认关闭
 * - 结果写到 <html data-motion>，animations.css 据此统一关闭所有过渡与动画
 */
import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'
import { loadString, saveString } from '@/utils/storage'

const media = window.matchMedia('(prefers-reduced-motion: reduce)')

export const useMotionStore = defineStore('motion', () => {
  const saved = loadString('motion') // 'on' | 'off' | ''
  const pref = ref(saved === 'on' || saved === 'off' ? saved : '')
  const systemReduce = ref(media.matches)
  media.addEventListener('change', (e) => (systemReduce.value = e.matches))

  const enabled = computed(() => (pref.value ? pref.value === 'on' : !systemReduce.value))

  watchEffect(() => {
    document.documentElement.dataset.motion = enabled.value ? 'on' : 'off'
  })

  function setEnabled(v) {
    pref.value = v ? 'on' : 'off'
    saveString('motion', pref.value)
  }

  return { enabled, setEnabled }
})
