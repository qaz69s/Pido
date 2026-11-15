/**
 * 自定义主色：用 OKLCH 从一个颜色生成整套 50–950 色阶
 * - OKLCH 的亮度是感知均匀的：同一个 L 在任何色相下看起来一样亮，色阶不会出现「黄色发灰、蓝色发黑」
 * - 每一级固定亮度 L，色度 C 按比例缩放，超出 sRGB 时逐步降低色度直到落在色域内
 * - 输出 "r g b" 字符串，直接写进 --b-* / --txb-* 变量（与 themes.css 的写法一致）
 */

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
// 每一级的目标亮度与色度系数（两端收一点色度，避免很浅/很深时颜色发脏）
const L = { 50: 0.975, 100: 0.945, 200: 0.89, 300: 0.81, 400: 0.72, 500: 0.64, 600: 0.56, 700: 0.49, 800: 0.42, 900: 0.36, 950: 0.27 }
const CK = { 50: 0.14, 100: 0.3, 200: 0.55, 300: 0.8, 400: 0.95, 500: 1, 600: 1, 700: 0.92, 800: 0.8, 900: 0.68, 950: 0.55 }

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (!/^[0-9a-f]{6}$/i.test(h) || Number.isNaN(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** sRGB(0–255) → OKLCH [L, C, H(度)] */
export function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L_ = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L_, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360]
}

/** OKLCH → 线性 sRGB（可能越界） */
function oklchToLinear(L_, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L_ + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L_ - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L_ - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** OKLCH → sRGB(0–255)，超出色域时降低色度 */
export function oklchToRgb(L_, C, H) {
  let c = C
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear(L_, c, H)
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return lin.map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))) * 255))
    }
    c *= 0.92
  }
  return oklchToLinear(L_, 0, H).map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.max(0, v)))) * 255))
}

/** 相对亮度（WCAG），用来决定主色按钮上的文字用白还是黑 */
function luminance([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => srgbToLinear(v / 255))
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/**
 * 由一个颜色生成主题变量
 * @returns {{ light: Record<string,string>, dark: Record<string,string> } | null}
 */
export function buildCustomVars(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [, C0, H] = rgbToOklch(rgb)
  // 几乎没有色度（灰色）时保持灰阶；否则保证色阶有足够的饱和度
  const C = C0 < 0.02 ? C0 : Math.max(C0, 0.09)
  const scale = {}
  for (const k of STEPS) scale[k] = oklchToRgb(L[k], C * CK[k], H)
  const str = (k) => scale[k].join(' ')

  const base = {}
  for (const k of STEPS) base[`--b-${k}`] = str(k)
  base['--on-b'] = luminance(scale[600]) > 0.36 ? '24 24 27' : '255 255 255'

  // 文字色：浅色以白卡片为底取偏深的几级，深色以深卡片为底取偏浅的几级
  const light = { ...base, '--txb-400': str(500), '--txb-500': str(600), '--txb-600': str(600), '--txb-700': str(700) }
  const dark = { ...base, '--txb-300': str(200), '--txb-400': str(300), '--txb-500': str(300), '--txb-600': str(400), '--txb-700': str(700) }
  return { light, dark }
}
