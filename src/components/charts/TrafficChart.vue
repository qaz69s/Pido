<script setup>
/**
 * 实时流量曲线（手写 Canvas，零依赖）
 * - 两条平滑曲线 + 渐变填充（上传 / 下载），颜色取主题变量（上传 accent、下载 brand）
 * - 单调三次插值（Fritsch–Carlson）：曲线不会在尖峰处冲到 0 以下或来回晃
 * - 数据里的 null 表示“还没有数据”，这一段不画（打开页面时曲线从右侧长出来）
 * - Y 轴按 1024 进制自动取“整”刻度，3 条淡实线
 * - 手指按住 / 鼠标悬停显示该时刻的上传、下载
 * - 适配高分屏（devicePixelRatio）和容器尺寸变化（ResizeObserver）
 * - 网格/文字颜色取自容器的 CSS color，因此会跟随深浅主题
 * - 动画：新数据到来时曲线在 1 秒内平滑左移；右端有呼吸光点（动画关闭时静态绘制）
 */
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from 'vue'
import { motionEnabled } from '@/utils/motion'
import { formatSpeed } from '@/utils/format'
import { useThemeStore } from '@/stores/theme'

const props = defineProps({
  up: { type: Array, required: true }, // 上传速率序列（字节/秒），旧 → 新；null = 还没有数据
  down: { type: Array, required: true }, // 下载速率序列
  height: { type: Number, default: 220 },
  // 不传时取主题变量：上传 = accent-500，下载 = brand-500（见 src/themes.css）
  upColor: { type: String, default: '' },
  downColor: { type: String, default: '' },
})

const wrap = ref(null)
const canvas = ref(null)
const theme = useThemeStore()

let ctx = null
// 注意：不要命名为 width/height，否则模板中的 height 会遮蔽同名 prop
let cw = 0 // 画布 CSS 宽度
let ch = 0 // 画布 CSS 高度
let raf = 0
let ro = null
let loopRaf = 0 // 动画循环
let shiftStart = 0 // 最近一次新数据到来的时间
const SHIFT_MS = 1000 // 平移时长，与 /traffic 推送间隔一致
let lead = [null, null] // 上一帧最左边被挤出去的点（上传、下载），平移时补在左侧，避免左边露出空隙

const PAD = { right: 8, top: 10, bottom: 22 }
let padLeft = 64 // 左边距按 Y 轴刻度文字宽度动态计算，防止长刻度被裁切
const GRID_LINES = 2
let hoverX = -1 // 悬停 / 按住的位置（CSS 像素），-1 表示不显示提示
let hoverTimer = 0

/** 颜色转 [r, g, b]：支持 #rrggbb 和 CSS 变量里的 "r g b" 写法 */
function toRgb(color) {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return color.trim().split(/\s+/).map(Number)
}

/** 读取主题变量（如 --a-500），读不到时用兜底色 */
function themeColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}

/** 颜色 → rgba(r,g,b,a) */
function withAlpha(color, alpha) {
  const [r, g, b] = toRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 取一个“好看”的最大值：1 / 2 / 5 / 10 × 1024^n */
function niceMax(value) {
  const min = 1024 // 最小刻度 1 KB/s
  if (!(value > min)) return min
  const power = Math.floor(Math.log(value) / Math.log(1024))
  const unit = 1024 ** power
  const scaled = value / unit
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : scaled <= 10 ? 10 : scaled <= 20 ? 20 : scaled <= 50 ? 50 : scaled <= 100 ? 100 : scaled <= 200 ? 200 : scaled <= 500 ? 500 : 1000
  return nice * unit
}

function resize() {
  if (!wrap.value || !canvas.value) return
  const rect = wrap.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return // KeepAlive 隐藏时尺寸为 0
  const dpr = window.devicePixelRatio || 1
  cw = rect.width
  ch = rect.height
  canvas.value.width = Math.round(cw * dpr)
  canvas.value.height = Math.round(ch * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  scheduleDraw()
}

function scheduleDraw() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

/** 单调三次插值（Fritsch–Carlson）：返回经过所有点、不会过冲的平滑路径 */
function monotonePath(pts) {
  const path = new Path2D()
  const n = pts.length
  if (!n) return path
  path.moveTo(pts[0][0], pts[0][1])
  if (n === 1) return path
  const dx = []
  const m = []
  const t = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]
  }
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    // 斜率异号（局部极值）时切线取 0，保证不过冲
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    path.bezierCurveTo(pts[i][0] + h, pts[i][1] + t[i] * h, pts[i + 1][0] - h, pts[i + 1][1] - t[i + 1] * h, pts[i + 1][0], pts[i + 1][1])
  }
  return path
}

/** 根据数据生成平滑曲线；null（还没有数据）的点跳过 */
function buildPath(data, max, plotW, plotH, offset = 0, leadValue = null) {
  const n = data.length
  const step = n > 1 ? plotW / (n - 1) : 0
  // offset：0~1，表示整条曲线还要向右多偏移几个“格”（平移动画用）
  // 平移中在最左边补一个被挤出的旧点，x 为 padLeft + (offset - 1) * step
  const series = offset > 0 ? [leadValue, ...data] : data
  const base = offset > 0 ? offset - 1 : 0
  const pts = []
  series.forEach((v, i) => {
    if (v == null) return
    pts.push([padLeft + (i + base) * step, PAD.top + plotH - (Math.min(Math.max(v, 0), max) / max) * plotH])
  })
  return { path: monotonePath(pts), pts }
}

function drawSeries(data, color, max, plotW, plotH, offset = 0, pulse = -1, leadValue = null) {
  const { path, pts } = buildPath(data, max, plotW, plotH, offset, leadValue)
  if (pts.length < 2) return
  const bottom = PAD.top + plotH

  // 渐变填充
  const area = new Path2D(path)
  area.lineTo(pts[pts.length - 1][0], bottom)
  area.lineTo(pts[0][0], bottom)
  area.closePath()
  const grad = ctx.createLinearGradient(0, PAD.top, 0, bottom)
  grad.addColorStop(0, withAlpha(color, 0.32))
  grad.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = grad
  ctx.fill(area)

  // 曲线
  ctx.strokeStyle = withAlpha(color, 1)
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke(path)

  // 右端呼吸光点：位于绘图区右边缘，y 在最后两点之间插值
  if (pulse >= 0) {
    const [x1, y1] = pts[pts.length - 2]
    const [x2, y2] = pts[pts.length - 1]
    const edge = padLeft + plotW
    const t = x2 === x1 ? 1 : Math.min(1, Math.max(0, (edge - x1) / (x2 - x1)))
    const y = y1 + (y2 - y1) * t
    ctx.fillStyle = withAlpha(color, 0.25 * (1 - pulse))
    ctx.beginPath()
    ctx.arc(edge, y, 3 + 6 * pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = withAlpha(color, 1)
    ctx.beginPath()
    ctx.arc(edge, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function draw() {
  if (!ctx || cw <= 0) return
  ctx.clearRect(0, 0, cw, ch)

  const textColor = getComputedStyle(wrap.value).color
  const valid = [...props.up, ...props.down].filter((v) => v != null)
  const max = niceMax(Math.max(0, ...valid) * 1.1)

  // 先算出所有刻度文字，按最宽的那个确定左边距
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  const labels = Array.from({ length: GRID_LINES + 1 }, (_, i) =>
    formatSpeed((max / GRID_LINES) * (GRID_LINES - i)),
  )
  padLeft = Math.ceil(Math.max(...labels.map((l) => ctx.measureText(l).width))) + 14
  const plotW = cw - padLeft - PAD.right
  const plotH = ch - PAD.top - PAD.bottom

  // 横向网格 + Y 轴刻度
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= GRID_LINES; i++) {
    const y = Math.round(PAD.top + (plotH / GRID_LINES) * i) + 0.5
    // 淡实线，底线稍深
    ctx.globalAlpha = i === GRID_LINES ? 0.22 : 0.1
    ctx.strokeStyle = textColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padLeft, y)
    ctx.lineTo(cw - PAD.right, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = textColor
    ctx.fillText(labels[i], padLeft - 8, y)
  }
  ctx.setLineDash([])

  // X 轴说明
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(`${props.down.length} 秒前`, padLeft, ch - 4)
  ctx.textAlign = 'right'
  ctx.fillText('现在', cw - PAD.right, ch - 4)

  const downColor = props.downColor || themeColor('--b-500', '#6366f1')
  const upColor = props.upColor || themeColor('--a-500', '#f59e0b')

  // 动画：offset 从 1 平滑降到 0（新点从右边缘滑入），pulse 0~1 循环
  const animate = motionEnabled()
  const now = performance.now()
  const offset = animate ? Math.max(0, 1 - (now - shiftStart) / SHIFT_MS) : 0
  const pulse = animate ? (now % 1600) / 1600 : -1

  ctx.save()
  ctx.beginPath()
  ctx.rect(padLeft, 0, plotW, ch) // 只在绘图区内画曲线，滑出的部分裁掉
  ctx.clip()
  drawSeries(props.down, downColor, max, plotW, plotH, offset, pulse, lead[1])
  drawSeries(props.up, upColor, max, plotW, plotH, offset, pulse, lead[0])
  ctx.restore()

  drawTooltip({ max, plotW, plotH, upColor, downColor, textColor })
}

/** 悬停 / 按住时：竖线 + 两个圆点 + 数值气泡 */
function drawTooltip({ max, plotW, plotH, upColor, downColor, textColor }) {
  const n = props.down.length
  if (hoverX < 0 || n < 2) return
  const step = plotW / (n - 1)
  const i = Math.round((hoverX - padLeft) / step)
  if (i < 0 || i >= n || props.down[i] == null) return
  const x = padLeft + i * step
  const yOf = (v) => PAD.top + plotH - (Math.min(Math.max(v ?? 0, 0), max) / max) * plotH
  const bottom = PAD.top + plotH

  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = textColor
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(Math.round(x) + 0.5, PAD.top)
  ctx.lineTo(Math.round(x) + 0.5, bottom)
  ctx.stroke()
  ctx.restore()

  for (const [v, c] of [[props.down[i], downColor], [props.up[i], upColor]]) {
    ctx.fillStyle = withAlpha(c, 1)
    ctx.beginPath()
    ctx.arc(x, yOf(v), 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // 气泡：放在竖线左侧，空间不够时放右侧
  const lines = [`↓ ${formatSpeed(props.down[i] ?? 0)}`, `↑ ${formatSpeed(props.up[i] ?? 0)}`]
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  const bw = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 20
  const bh = 44
  let bx = x - bw - 10
  if (bx < padLeft) bx = x + 10
  const by = PAD.top + 2
  const tile = themeColor('--s-tile', '241 245 249')
  ctx.fillStyle = withAlpha(tile, 0.96)
  ctx.strokeStyle = withAlpha(textColor.match(/\d+/g)?.slice(0, 3).join(' ') || '100 116 139', 0.25)
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = getComputedStyle(document.body).color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(lines[0], bx + 10, by + 14)
  ctx.fillText(lines[1], bx + 10, by + 31)
}

/* ---------- 悬停 / 触摸 ---------- */
function onPointer(e) {
  const rect = wrap.value.getBoundingClientRect()
  hoverX = e.clientX - rect.left
  clearTimeout(hoverTimer)
  scheduleDraw()
}
function onPointerEnd(e) {
  clearTimeout(hoverTimer)
  // 触摸松手后提示再停留 1.5 秒；鼠标移出立即消失
  hoverTimer = setTimeout(() => {
    hoverX = -1
    scheduleDraw()
  }, e.pointerType === 'mouse' ? 0 : 1500)
}

/** 动画循环：页面可见、动画开启时每帧重绘；否则停下，仅在数据变化时重绘 */
function loop() {
  cancelAnimationFrame(loopRaf)
  if (!motionEnabled() || document.hidden || cw <= 0) {
    loopRaf = 0
    return
  }
  draw()
  loopRaf = requestAnimationFrame(loop)
}
function startLoop() {
  if (!loopRaf) loopRaf = requestAnimationFrame(loop)
}
function stopLoop() {
  cancelAnimationFrame(loopRaf)
  loopRaf = 0
}
function onVisibility() {
  if (document.hidden) stopLoop()
  else startLoop()
}

watch(
  () => [props.up, props.down],
  (_, old) => {
    lead = [old?.[0]?.[0] ?? null, old?.[1]?.[0] ?? null]
    shiftStart = performance.now()
    scheduleDraw()
    startLoop()
  },
)
// 深浅色或主题配色变化时重绘
watch(() => [theme.isDark, theme.preset], () => nextTick(scheduleDraw))

onMounted(() => {
  ctx = canvas.value.getContext('2d')
  ro = new ResizeObserver(resize)
  ro.observe(wrap.value)
  resize()
  document.addEventListener('visibilitychange', onVisibility)
  startLoop()
})
onActivated(() => {
  resize()
  startLoop()
})
onDeactivated(stopLoop)
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
  stopLoop()
  clearTimeout(hoverTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div
    ref="wrap"
    class="relative w-full touch-pan-y select-none text-slate-500 dark:text-slate-400"
    :style="{ height: `${props.height}px` }"
    @pointerdown="onPointer"
    @pointermove="onPointer"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @pointerleave="onPointerEnd"
  >
    <canvas ref="canvas" class="absolute inset-0 h-full w-full" />
  </div>
</template>
