/**
 * 主题配色列表
 * - id 对应 src/themes.css 中的 [data-theme='id']
 * - swatch：设置页色块预览用（中性色、主色、强调色）
 * - meta：浏览器地址栏颜色（浅色 / 深色）
 */
export const THEME_PRESETS = [
  { id: 'default', name: '靛夜', desc: '沉稳的靛蓝，默认配色', swatch: ['#0f172a', '#6366f1', '#f59e0b'], meta: ['#f8fafc', '#020617'] },
  { id: 'nord', name: '北境', desc: 'Nord 冷色调，低饱和护眼', swatch: ['#2e3440', '#5e81ac', '#ebcb8b'], meta: ['#f6f8fb', '#242933'] },
  { id: 'neutral', name: '素墨', desc: '纯中性灰，黑白极简', swatch: ['#1a1a1a', '#262626', '#e5e5e5'], meta: ['#fafafa', '#1a1a1a'] },
  { id: 'sakura', name: '樱花', desc: '粉紫渐变，大圆角', swatch: ['#2a1f25', '#ec4899', '#8b5cf6'], meta: ['#fdf8f9', '#1a1317'] },
  { id: 'cyber', name: '赛博', desc: '霓虹 + 等宽字体，硬朗直角', swatch: ['#18181b', '#d946ef', '#06b6d4'], meta: ['#fafafa', '#09090b'] },
  { id: 'sunset', name: '暖阳', desc: '温暖的橙与米色', swatch: ['#1c1917', '#f97316', '#f43f5e'], meta: ['#fafaf9', '#0c0a09'] },
]

export const PRESET_IDS = THEME_PRESETS.map((t) => t.id)
