/**
 * 主题
 * - mode：跟随系统 / 浅色 / 深色
 * - preset：配色方案（见 utils/themes.js 与 themes.css）
 * - 选择保存在 localStorage（index.html 里的内联脚本会提前读取，防止闪白）
 * - 跟随系统时监听 prefers-color-scheme 变化
 * - oled：深色下使用纯黑底色（OLED 省电），写到 <html data-oled>
 * - customColor：preset 为 custom 时，用 OKLCH 从这个颜色生成主色色阶（utils/oklch.js），写成 <html> 的内联变量
 *   生成结果同时存到 localStorage（custom-vars），index.html 的内联脚本在挂载前直接套用，避免闪色
 * - 手机状态栏 / PWA 标题栏颜色（meta theme-color）取当前页面底色，随主题和深浅色变化
 * - 手动切换时，新主题从点击位置圆形扩散铺满全屏（View Transitions API，不支持的浏览器直接切换）
 */
import { defineStore } from 'pinia'
import { ref, computed, watchEffect, nextTick } from 'vue'
import { motionEnabled } from '@/utils/motion'
import { loadString, saveString } from '@/utils/storage'
import { THEME_PRESETS, PRESET_IDS } from '@/utils/themes'
import { buildCustomVars } from '@/utils/oklch'
import { saveJSON } from '@/utils/storage'

const media = window.matchMedia('(prefers-color-scheme: dark)')
export const THEME_MODES = ['system', 'light', 'dark']

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(THEME_MODES.includes(loadString('theme')) ? loadString('theme') : 'system')
  // 旧名称兼容：抹茶（matcha）、墨玉（jade）已合并为素墨（neutral）
  const LEGACY = { matcha: 'neutral', jade: 'neutral' }
  const saved = LEGACY[loadString('preset')] || loadString('preset')
  const preset = ref(PRESET_IDS.includes(saved) || saved === 'custom' ? saved : 'default')
  const oled = ref(loadString('oled') === 'on')
  const customColor = ref(/^#[0-9a-f]{6}$/i.test(loadString('custom-color')) ? loadString('custom-color') : '#0ea5e9')
  const systemDark = ref(media.matches)
  media.addEventListener('change', (e) => (systemDark.value = e.matches))

  const isDark = computed(
    () => mode.value === 'dark' || (mode.value === 'system' && systemDark.value),
  )
  const presetInfo = computed(() => THEME_PRESETS.find((t) => t.id === preset.value) || THEME_PRESETS[0])
  const customVars = computed(() => buildCustomVars(customColor.value))

  /** 上一次写到 <html> 上的自定义变量名，换主题时清掉 */
  let appliedVars = []

  // 同步到 <html class="dark" data-theme="..." data-oled="...">、自定义主色变量和状态栏颜色
  watchEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark.value)
    root.dataset.theme = preset.value
    root.dataset.oled = oled.value ? 'on' : 'off'

    for (const k of appliedVars) root.style.removeProperty(k)
    appliedVars = []
    if (preset.value === 'custom' && customVars.value) {
      const vars = customVars.value[isDark.value ? 'dark' : 'light']
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
      appliedVars = Object.keys(vars)
    }

    // 状态栏颜色 = 实际页面底色（--s-page），深色、纯黑、各主题都自动对上
    const page = getComputedStyle(root).getPropertyValue('--s-page').trim().split(/\s+/).map(Number)
    const color = page.length === 3 && page.every((n) => Number.isFinite(n))
      ? `rgb(${page.join(', ')})`
      : presetInfo.value.meta[isDark.value ? 1 : 0]
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  })

  // 自定义变量存一份，供 index.html 在挂载前套用
  watchEffect(() => saveJSON('custom-vars', customVars.value))

  /**
   * 带圆形扩散动画地执行一次主题变更
   * @param {Function} apply 实际修改状态的函数
   * @param {MouseEvent} [event] 点击事件，用来确定扩散圆心；没有时从屏幕中心扩散
   */
  function reveal(apply, event) {
    const before = `${isDark.value}|${preset.value}|${oled.value}`
    if (!motionEnabled() || !document.startViewTransition) return apply()
    const x = event?.clientX ?? window.innerWidth / 2
    const y = event?.clientY ?? window.innerHeight / 2
    const t = document.startViewTransition(async () => {
      apply()
      await nextTick() // 等 watchEffect 把 class / data-theme 写到 <html>
    })
    t.ready
      .then(() => {
        if (`${isDark.value}|${preset.value}|${oled.value}` === before) return // 外观没变，不放动画
        const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 480, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {})
  }

  function setMode(m, event) {
    reveal(() => {
      mode.value = m
      saveString('theme', m)
    }, event)
  }

  function setPreset(id, event) {
    if (!PRESET_IDS.includes(id) && id !== 'custom') return
    reveal(() => {
      preset.value = id
      saveString('preset', id)
    }, event)
  }

  function setOled(v) {
    oled.value = !!v
    saveString('oled', v ? 'on' : 'off')
  }

  /** 选择自定义主色：切到 custom 配色并保存颜色（取色器拖动时频繁调用，不放扩散动画） */
  function setCustomColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return
    customColor.value = hex
    saveString('custom-color', hex)
    if (preset.value !== 'custom') {
      preset.value = 'custom'
      saveString('preset', 'custom')
    }
  }

  /** 依次切换：系统 → 浅色 → 深色 → 系统 */
  function cycle(event) {
    const i = THEME_MODES.indexOf(mode.value)
    setMode(THEME_MODES[(i + 1) % THEME_MODES.length], event)
  }

  return { mode, preset, presetInfo, isDark, oled, customColor, setMode, setPreset, setOled, setCustomColor, cycle }
})
