/**
 * 主题
 * - mode：跟随系统 / 浅色 / 深色
 * - preset：配色方案（见 utils/themes.js 与 themes.css）
 * - 选择保存在 localStorage（index.html 里的内联脚本会提前读取，防止闪白）
 * - 跟随系统时监听 prefers-color-scheme 变化
 */
import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'
import { loadString, saveString } from '@/utils/storage'
import { THEME_PRESETS, PRESET_IDS } from '@/utils/themes'

const media = window.matchMedia('(prefers-color-scheme: dark)')
export const THEME_MODES = ['system', 'light', 'dark']

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(THEME_MODES.includes(loadString('theme')) ? loadString('theme') : 'system')
  // 旧名称兼容：抹茶（matcha）、墨玉（jade）已合并为素墨（neutral）
  const LEGACY = { matcha: 'neutral', jade: 'neutral' }
  const saved = LEGACY[loadString('preset')] || loadString('preset')
  const preset = ref(PRESET_IDS.includes(saved) ? saved : 'default')
  const systemDark = ref(media.matches)
  media.addEventListener('change', (e) => (systemDark.value = e.matches))

  const isDark = computed(
    () => mode.value === 'dark' || (mode.value === 'system' && systemDark.value),
  )
  const presetInfo = computed(() => THEME_PRESETS.find((t) => t.id === preset.value) || THEME_PRESETS[0])

  // 同步到 <html class="dark" data-theme="..."> 和浏览器地址栏颜色
  watchEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark.value)
    root.dataset.theme = preset.value
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', presetInfo.value.meta[isDark.value ? 1 : 0])
  })

  function setMode(m) {
    mode.value = m
    saveString('theme', m)
  }

  function setPreset(id) {
    if (!PRESET_IDS.includes(id)) return
    preset.value = id
    saveString('preset', id)
  }

  /** 依次切换：系统 → 浅色 → 深色 → 系统 */
  function cycle() {
    const i = THEME_MODES.indexOf(mode.value)
    setMode(THEME_MODES[(i + 1) % THEME_MODES.length])
  }

  return { mode, preset, presetInfo, isDark, setMode, setPreset, cycle }
})
