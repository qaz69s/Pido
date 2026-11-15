/**
 * Tailwind + daisyUI 配置
 * - 颜色、组件全部使用 daisyUI：主题定义在 src/utils/themes.js（每套配色浅色 / 深色各一个主题，共 12 个）
 * - 切换 <html data-theme="nord-dark"> 即可换主题（见 stores/theme.js）；dark: 变体跟随以 -dark 结尾的主题
 * - 圆角跟随主题变量：rounded-lg = 按钮圆角（--rounded-btn），rounded-2xl = 卡片圆角（--rounded-box），其余按比例
 */
import daisyui from 'daisyui'
import { DAISY_THEMES } from './src/utils/themes.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  // dark: 变体：<html data-theme="*-dark"> 时生效（少量非语义色仍用到，如延迟偏高的橙色）
  darkMode: ['variant', '&:where([data-theme$="-dark"], [data-theme$="-dark"] *)'],
  theme: {
    extend: {
      // 三档浮起：sm 贴面（分段选中块）、DEFAULT/md 浮动（菜单、Toast）、lg/xl 弹层（弹窗）；均为近实 + 远虚两层
      boxShadow: {
        sm: '0 1px 2px rgb(15 23 42 / 0.06), 0 1px 1px rgb(15 23 42 / 0.04)',
        DEFAULT: '0 2px 4px -1px rgb(15 23 42 / 0.06), 0 8px 20px -4px rgb(15 23 42 / 0.10)',
        md: '0 2px 4px -1px rgb(15 23 42 / 0.06), 0 8px 20px -4px rgb(15 23 42 / 0.10)',
        lg: '0 4px 8px -2px rgb(15 23 42 / 0.08), 0 24px 48px -12px rgb(15 23 42 / 0.22)',
        xl: '0 4px 8px -2px rgb(15 23 42 / 0.08), 0 24px 48px -12px rgb(15 23 42 / 0.22)',
      },
      // 字号四档：12 / 13 / 15 / 18（行高按中文略放宽）
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['13px', '20px'],
        base: ['15px', '22px'],
        lg: ['18px', '26px'],
      },
      // 统一动效：所有 transition 类默认同一条缓动曲线和时长（与 style.css 的 --ease / --dur-* 一致）
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      transitionDuration: { DEFAULT: '180ms' },
      // 圆角跟随 daisyUI 主题变量（各配色更圆或更方）
      borderRadius: {
        md: 'calc(var(--rounded-btn, 0.5rem) * 0.75)',
        lg: 'var(--rounded-btn, 0.5rem)',
        xl: 'calc(var(--rounded-box, 1rem) * 0.75)',
        '2xl': 'var(--rounded-box, 1rem)',
        '3xl': 'calc(var(--rounded-box, 1rem) * 1.5)',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    // 第一个主题是 :root 的默认主题；系统深色且尚未写入 data-theme 时用 darkTheme
    themes: [DAISY_THEMES],
    darkTheme: 'default-dark',
    logs: false,
  },
}
