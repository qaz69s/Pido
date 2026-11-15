<script setup>
/**
 * 日志页
 * - WebSocket /logs?level=xxx 实时接收内核日志
 * - 级别切换会自动重连（useStream 的 query 传函数）
 * - 最新的在最上面；最多保留 MAX_LOGS 条
 * - 搜索、暂停（暂停期间缓存新日志）、清空、导出为 txt
 * 本页在 App.vue 中被 KeepAlive 缓存，切换页面后日志不会丢失
 * dae / honk（标准 API）：由 ws.js 改为 SSE（GET /api/v1/logs），消息整理成相同的 { type, payload }，
 *   并带上后端记录的时间（续传时补发的旧日志显示原始时间）
 */
import { computed, ref, watch } from 'vue'
import { useStream } from '@/composables/useStream'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { loadString, saveString } from '@/utils/storage'
import { formatClock } from '@/utils/format'
import { useBackendStore } from '@/stores/backend'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'

const MAX_LOGS = 1000
const backend = useBackendStore()

const LEVELS = [
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '错误' },
]

/** 各级别的标签样式 */
const LEVEL_CLASS = {
  debug: 'bg-tile text-slate-500 dark:text-slate-400',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
}
const LEVEL_TEXT = { debug: 'DBG', info: 'INF', warning: 'WRN', error: 'ERR' }

/* ---------- 状态 ---------- */
const level = ref(LEVELS.some((l) => l.value === loadString('log-level')) ? loadString('log-level') : 'info')
watch(level, (v) => saveString('log-level', v))

const logs = ref([]) // 新的在前
const pending = [] // 暂停期间收到的日志
const pendingCount = ref(0)
const paused = ref(false)
let seq = 0

/** 收到日志：批量合并到下一帧再更新，避免日志刷屏时每条都触发渲染 */
let buffer = []
let raf = 0
function flush() {
  raf = 0
  if (!buffer.length) return
  logs.value = [...buffer.reverse(), ...logs.value].slice(0, MAX_LOGS)
  buffer = []
}

const { status } = useStream('/logs', {
  query: () => ({ level: level.value }),
  onMessage(d) {
    const entry = { id: ++seq, time: d.time ?? Date.now(), type: d.type, payload: d.payload ?? '' }
    if (paused.value) {
      pending.push(entry)
      if (pending.length > MAX_LOGS) pending.shift()
      pendingCount.value = pending.length
      return
    }
    buffer.push(entry)
    if (!raf) raf = requestAnimationFrame(flush)
  },
})

function togglePause() {
  paused.value = !paused.value
  if (!paused.value && pending.length) {
    // 恢复时把缓存的日志补上
    logs.value = [...pending.reverse(), ...logs.value].slice(0, MAX_LOGS)
    pending.length = 0
    pendingCount.value = 0
  }
}

function clearLogs() {
  logs.value = []
  pending.length = 0
  pendingCount.value = 0
}

/* ---------- 筛选 ---------- */
const keyword = ref('')
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return logs.value
  return logs.value.filter((l) => l.payload.toLowerCase().includes(kw))
})
const { visible, sentinel, hasMore, reset } = useInfiniteList(filtered, 200)
watch(keyword, reset)

/* ---------- 导出 ---------- */
function exportLogs() {
  const lines = [...filtered.value]
    .reverse() // 导出时按时间正序
    .map((l) => `${new Date(l.time).toISOString()} [${l.type}] ${l.payload}`)
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${backend.engine}-logs-${Date.now()}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const STATUS = {
  open: { dot: 'bg-emerald-500', text: '实时' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: '连接中' },
  reconnecting: { dot: 'bg-amber-400 animate-pulse', text: '重连中' },
  error: { dot: 'bg-rose-500', text: '连接失败' },
  unsupported: { dot: 'bg-slate-400', text: '后端未开放日志' },
}
const statusInfo = computed(() => STATUS[status.value] || { dot: 'bg-slate-400', text: '未连接' })
</script>

<template>
  <div class="space-y-3">
    <!-- 工具栏 -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- 级别：桌面分段按钮，手机下拉框 -->
      <div class="hidden rounded-lg bg-slate-200/70 p-0.5 text-sm sm:flex dark:bg-slate-800">
        <button
          v-for="l in LEVELS"
          :key="l.value"
          class="rounded-md px-3 py-1 transition"
          :class="level === l.value ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'"
          @click="level = l.value"
        >
          {{ l.label }}
        </button>
      </div>
      <select v-model="level" class="input w-auto py-1.5 sm:hidden" title="日志级别">
        <option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}及以上</option>
      </select>

      <span class="flex items-center gap-1.5 text-xs text-slate-500">
        <span class="h-2 w-2 rounded-full" :class="statusInfo.dot" />
        {{ statusInfo.text }}
      </span>

      <div class="relative order-last w-full sm:order-none sm:w-auto sm:flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input v-model="keyword" type="search" class="input py-1.5 pl-8" placeholder="搜索日志内容" />
      </div>

      <div class="ml-auto flex items-center gap-1">
        <button
          class="btn-icon"
          :class="paused && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'"
          :title="paused ? '继续' : '暂停'"
          @click="togglePause"
        >
          <Icon :name="paused ? 'play' : 'pause'" class="h-[18px] w-[18px]" />
        </button>
        <button class="btn-icon" title="导出为文本" :disabled="!filtered.length" @click="exportLogs">
          <Icon name="download" class="h-[18px] w-[18px]" />
        </button>
        <button class="btn-icon" title="清空" :disabled="!logs.length && !pendingCount" @click="clearLogs">
          <Icon name="trash" class="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>

    <div
      v-if="paused"
      class="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <Icon name="pause" class="h-4 w-4 shrink-0" />
      <span class="flex-1">已暂停，期间收到 {{ pendingCount }} 条新日志</span>
      <button class="btn-outline py-1 text-xs" @click="togglePause">继续</button>
    </div>
    <div
      v-else-if="status === 'error'"
      class="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200"
    >
      <Icon name="alert" class="h-4 w-4 shrink-0" />
      日志连接失败，请检查后端地址和 secret。
    </div>

    <!-- 日志列表 -->
    <div v-if="!filtered.length" class="card">
      <EmptyState
        :icon="keyword ? 'search' : 'terminal'"
        :title="keyword ? '没有匹配的日志' : '等待日志…'"
        :description="keyword ? '' : level === 'error' || level === 'warning' ? '当前级别较高，只有出现问题时才会有日志。' : '有新连接或内核事件时会显示在这里。'"
      />
    </div>
    <div v-else class="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
      <div v-for="l in visible" :key="l.id" class="flex gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div class="flex shrink-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span class="text-xs tabular-nums text-slate-400 sm:w-14">{{ formatClock(l.time) }}</span>
          <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="LEVEL_CLASS[l.type] || LEVEL_CLASS.debug">
            {{ LEVEL_TEXT[l.type] || l.type }}
          </span>
        </div>
        <p class="min-w-0 flex-1 whitespace-pre-wrap font-mono [overflow-wrap:anywhere] text-[12.5px] leading-5">{{ l.payload }}</p>
      </div>
      <div v-if="hasMore" ref="sentinel" class="py-3 text-center text-xs text-slate-400">加载中…</div>
    </div>
    <p v-if="logs.length" class="text-center text-xs text-slate-400">
      显示最近 {{ logs.length }} 条（最多保留 {{ MAX_LOGS }} 条）
    </p>
  </div>
</template>
