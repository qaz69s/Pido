/**
 * Tailwind 配置
 * - 颜色全部指向 CSS 变量（定义在 src/themes.css），切换 <html data-theme="..."> 即可换主题
 * - slate 被替换为主题的中性色，这样现有组件无需改动类名
 * - brand：主色；accent：强调色（上传曲线等）
 * - 圆角乘以 --radius-scale，不同主题可以更圆或更方
 */

/** 生成 50~950 的变量色板，支持 bg-brand-500/20 这类透明度写法 */
function palette(prefix) {
  const keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
  return Object.fromEntries(keys.map((k) => [k, `rgb(var(--${prefix}-${k}) / <alpha-value>)`]))
}

/** 文字专用色板：优先用 --tx-* / --txb-*（对比度修正过），未定义时回退到背景色板 */
function textPalette(prefix, fallback) {
  const keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
  return Object.fromEntries(
    keys.map((k) => [k, `rgb(var(--${prefix}-${k}, var(--${fallback}-${k})) / <alpha-value>)`]),
  )
}

const r = (rem) => `calc(${rem}rem * var(--radius-scale, 1))`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  // 使用 class 策略：由 stores/theme.js 给 <html> 加/去 .dark
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: palette('n'),
        brand: palette('b'),
        accent: palette('a'),
        // 主色背景上的文字色（大多数主题为白色，素墨深色下为深灰）
        'on-brand': 'rgb(var(--on-b, 255 255 255) / <alpha-value>)',
      },
      // 文字颜色单独走对比度修正后的变量（见 src/themes.css 末尾）
      textColor: {
        slate: textPalette('tx', 'n'),
        brand: textPalette('txb', 'b'),
      },
      borderRadius: {
        md: r(0.375),
        lg: r(0.5),
        xl: r(0.75),
        '2xl': r(1),
        '3xl': r(1.5),
      },
    },
  },
  plugins: [],
}
