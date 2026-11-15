#!/usr/bin/env node
/**
 * daisyUI 主题对比度检查（替代原来的 scripts/dark-contrast.py）
 * 读取 src/utils/themes.js 的 DAISY_THEMES，按 WCAG 公式输出每个主题的关键对比度：
 *   - 主按钮：primary-content / primary（目标 ≥ 4.5:1）
 *   - 主色文字：primary / base-100 卡片（目标 ≥ 4.5:1）
 *   - 正文：base-content / base-100（目标 ≥ 7:1）
 *   - 层次：base-100 卡片 / base-300 页面（深色目标 ≈ 1.32:1）
 * 新增或调整配色后运行：node scripts/theme-contrast.mjs
 */
import { DAISY_THEMES } from '../src/utils/themes.js'

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((x) => {
    const c = x / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const fmt = (v, min) => `${v.toFixed(2)}${min && v < min ? ' ⚠' : ''}`

const rows = Object.entries(DAISY_THEMES).map(([name, t]) => ({
  主题: name,
  主按钮: fmt(ratio(t['primary-content'], t.primary), 4.5),
  主色文字: fmt(ratio(t.primary, t['base-100']), 4.5),
  正文: fmt(ratio(t['base-content'], t['base-100']), 7),
  '卡片/背景': ratio(t['base-100'], t['base-300']).toFixed(2),
}))
console.table(rows)
