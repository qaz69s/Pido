<script setup>
/**
 * 实时流量曲线（手写 Canvas，零依赖）
 * - 两条平滑曲线 + 渐变填充（上传 / 下载）
 * - Y 轴按 1024 进制自动取“整”刻度
 * - 适配高分屏（devicePixelRatio）和容器尺寸变化（ResizeObserver）
 * - 网格/文字颜色取自容器的 CSS color，因此会跟随深浅主题
 */
import { ref, watch, onMounted, onBeforeUnmount, onActivated, nextTick } from 'vue'
import { formatSpeed } from '@/utils/format'
import { useThemeStore } from '@/stores/theme'

const props = defineProps({
  up: { type: Array, required: true }, // 上传速率序列（字节/秒），旧 → 新
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

const PAD = { right: 8, top: 10, bottom: 22 }
let padLeft = 64 // 左边距按 Y 轴刻度文字宽度动态计算，防止长刻度被裁切
const GRID_LINES = 4

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

/** 根据数据生成平滑曲线（二次贝塞尔经过相邻点中点） */
function buildPath(data, max, plotW, plotH) {
  const n = data.length
  const step = n > 1 ? plotW / (n - 1) : 0
  const pts = data.map((v, i) => [padLeft + i * step, PAD.top + plotH - (Math.min(v, max) / max) * plotH])
  const path = new Path2D()
  if (!pts.length) return { path, pts }
  path.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]
    const [x, y] = pts[i]
    path.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2)
  }
  const last = pts[pts.length - 1]
  path.lineTo(last[0], last[1])
  return { path, pts }
}

function drawSeries(data, color, max, plotW, plotH) {
  const { path, pts } = buildPath(data, max, plotW, plotH)
  if (pts.length < 2) return
  const bottom = PAD.top + plotH

  // 渐变填充
  const area = new Path2D(path)
  area.lineTo(pts[pts.length - 1][0], bottom)
  area.lineTo(pts[0][0], bottom)
  area.closePath()
  const grad = ctx.createLinearGradient(0, PAD.top, 0, bottom)
  grad.addColorStop(0, withAlpha(color, 0.28))
  grad.addColorStop(1, withAlpha(color, 0))
  ctx.fillStyle = grad
  ctx.fill(area)

  // 曲线
  ctx.strokeStyle = withAlpha(color, 1)
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}

function draw() {
  if (!ctx || cw <= 0) return
  ctx.clearRect(0, 0, cw, ch)

  const textColor = getComputedStyle(wrap.value).color
  const max = niceMax(Math.max(0, ...props.up, ...props.down) * 1.1)

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
    ctx.globalAlpha = 0.18
    ctx.strokeStyle = textColor
    ctx.lineWidth = 1
    ctx.setLineDash(i === GRID_LINES ? [] : [3, 4])
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
  drawSeries(props.down, downColor, max, plotW, plotH)
  drawSeries(props.up, upColor, max, plotW, plotH)
}

watch(() => [props.up, props.down], scheduleDraw)
// 深浅色或主题配色变化时重绘
watch(() => [theme.isDark, theme.preset], () => nextTick(scheduleDraw))

onMounted(() => {
  ctx = canvas.value.getContext('2d')
  ro = new ResizeObserver(resize)
  ro.observe(wrap.value)
  resize()
})
onActivated(resize)
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div ref="wrap" class="relative w-full text-slate-500 dark:text-slate-400" :style="{ height: `${props.height}px` }">
    <canvas ref="canvas" class="absolute inset-0 h-full w-full" />
  </div>
</template>
