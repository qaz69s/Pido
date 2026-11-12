/**
 * 格式化工具：字节、速率、时间、延迟
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** 字节数 → 可读字符串，如 1536 → "1.5 KB" */
export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : digits)} ${UNITS[i]}`
}

/** 每秒字节数 → "1.5 MB/s" */
export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`
}

/** 时间点 → "x 分钟前"；无效时间（如 0001-01-01）返回 "--" */
export function formatRelativeTime(input) {
  const t = new Date(input).getTime()
  if (!Number.isFinite(t) || t <= 0) return '--'
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/** Unix 秒 → "2026/12/31" */
export function formatDate(unixSeconds) {
  if (!unixSeconds) return '--'
  return new Date(unixSeconds * 1000).toLocaleDateString('zh-CN')
}

/**
 * 延迟分级
 * - undefined/null：未测试
 * - 0：超时 / 失败
 */
export function delayLevel(delay) {
  if (delay == null) return 'none'
  if (delay === 0) return 'timeout'
  if (delay < 200) return 'good'
  if (delay < 500) return 'ok'
  return 'bad'
}

/** 延迟分级对应的文字颜色 */
export const DELAY_TEXT_CLASS = {
  none: 'text-slate-400 dark:text-slate-500',
  timeout: 'text-rose-500',
  good: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-amber-500',
  bad: 'text-orange-600 dark:text-orange-400',
}

/** 延迟分级对应的背景色（折叠时的小圆点） */
export const DELAY_BG_CLASS = {
  none: 'bg-slate-300 dark:bg-slate-600',
  timeout: 'bg-rose-500',
  good: 'bg-emerald-500',
  ok: 'bg-amber-400',
  bad: 'bg-orange-500',
}

export function delayText(delay) {
  if (delay == null) return '--'
  if (delay === 0) return '超时'
  return `${delay} ms`
}

/**
 * 安全地把时间解析为毫秒时间戳；无效（含 Go 的零值 0001-01-01）返回 NaN
 */
export function parseTime(input) {
  const t = new Date(input).getTime()
  return Number.isFinite(t) && t > 0 ? t : NaN
}

/** 持续时长：从 start 到现在，如 "35 秒"、"3 分 12 秒"、"2 小时 5 分" */
export function formatDuration(start, now = Date.now()) {
  const t = parseTime(start)
  if (Number.isNaN(t)) return '--'
  let s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  s %= 60
  if (m < 60) return `${m} 分 ${s} 秒`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时 ${m % 60} 分`
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`
}

/** 时间戳 → "23:45:01" */
export function formatClock(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
