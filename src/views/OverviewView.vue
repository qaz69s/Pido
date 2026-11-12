<script setup>
/**
 * 概览页
 * - /traffic    实时上下行速率（每秒一条）→ 曲线保留最近 60 秒
 * - /memory     内存占用
 * - /connections 活动连接数与累计流量
 * - GET /configs 运行模式、端口、TUN 状态
 * 本页在 App.vue 中被 KeepAlive 缓存，切走再回来曲线不会清空
 */
import { computed, reactive, ref, onMounted, onActivated } from 'vue'
import { useStream } from '@/composables/useStream'
import { useBackendStore } from '@/stores/backend'
import { getConfigs } from '@/api/configs'
import { formatBytes, formatSpeed } from '@/utils/format'
import TrafficChart from '@/components/charts/TrafficChart.vue'
import Icon from '@/components/common/Icon.vue'

const MAX_POINTS = 60
const backend = useBackendStore()

/* ---------- 实时流量 ---------- */
const speed = reactive({ up: 0, down: 0 })
const upHistory = ref(Array(MAX_POINTS).fill(0))
const downHistory = ref(Array(MAX_POINTS).fill(0))

const traffic = useStream('/traffic', {
  onMessage(d) {
    speed.up = d.up ?? 0
    speed.down = d.down ?? 0
    // 每次生成新数组，触发图表重绘
    upHistory.value = [...upHistory.value.slice(1 - MAX_POINTS), speed.up]
    downHistory.value = [...downHistory.value.slice(1 - MAX_POINTS), speed.down]
  },
})

/* ---------- 内存 ---------- */
const memory = ref(0)
const memoryStream = useStream('/memory', {
  onMessage(d) {
    memory.value = d.inuse ?? 0
  },
})

/* ---------- 连接 ---------- */
const conn = reactive({ count: 0, uploadTotal: 0, downloadTotal: 0 })
const connStream = useStream('/connections', {
  query: { interval: 2000 }, // 每 2 秒推送一次快照，概览页不需要更频繁
  onMessage(d) {
    conn.count = d.connections?.length ?? 0
    conn.uploadTotal = d.uploadTotal ?? 0
    conn.downloadTotal = d.downloadTotal ?? 0
  },
})

/** 任一数据流反复握手失败 → 提示 */
const streamError = computed(() =>
  [traffic.status.value, memoryStream.status.value, connStream.status.value].includes('error'),
)

/* ---------- 运行信息 ---------- */
const configs = ref(null)
async function loadConfigs() {
  try {
    configs.value = await getConfigs()
  } catch {
    /* 连接异常由顶部 ErrorBanner 统一提示 */
  }
}
onMounted(loadConfigs)
onActivated(loadConfigs)

const MODE_LABEL = { rule: '规则', global: '全局', direct: '直连' }

const stats = computed(() => [
  { label: '上传速率', value: formatSpeed(speed.up), icon: 'arrowUp', color: 'text-amber-500 bg-amber-500/10' },
  { label: '下载速率', value: formatSpeed(speed.down), icon: 'arrowDown', color: 'text-sky-500 bg-sky-500/10' },
  { label: '上传总量', value: formatBytes(conn.uploadTotal), icon: 'upload', color: 'text-amber-500/80 bg-amber-500/5' },
  { label: '下载总量', value: formatBytes(conn.downloadTotal), icon: 'download', color: 'text-sky-500/80 bg-sky-500/5' },
  { label: '内存占用', value: formatBytes(memory.value), icon: 'cpu', color: 'text-emerald-500 bg-emerald-500/10' },
  { label: '活动连接', value: String(conn.count), icon: 'link', color: 'text-violet-500 bg-violet-500/10' },
])

const infoRows = computed(() => {
  const c = configs.value
  return [
    { label: '内核版本', value: backend.version?.version || '--' },
    { label: '运行模式', value: c ? MODE_LABEL[c.mode?.toLowerCase()] || c.mode : '--' },
    { label: '混合端口', value: c?.['mixed-port'] || '--' },
    { label: 'TUN', value: c ? (c.tun?.enable ? '已开启' : '已关闭') : '--' },
    { label: '局域网访问', value: c ? (c['allow-lan'] ? '允许' : '不允许') : '--' },
  ]
})
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="streamError && backend.status !== 'error'"
      class="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <Icon name="alert" class="h-4 w-4 shrink-0" />
      实时数据连接失败，正在自动重试。若持续出现，请检查 secret 或网络。
    </div>

    <!-- 指标卡片 -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <div v-for="s in stats" :key="s.label" class="card flex items-center gap-3 p-3">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl" :class="s.color">
          <Icon :name="s.icon" class="h-[18px] w-[18px]" />
        </span>
        <div class="min-w-0">
          <div class="text-xs text-slate-500">{{ s.label }}</div>
          <div class="truncate font-semibold tabular-nums">{{ s.value }}</div>
        </div>
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-3">
      <!-- 流量曲线 -->
      <section class="card p-4 lg:col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">实时流量</h2>
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span class="flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-amber-500" />上传</span>
            <span class="flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-sky-500" />下载</span>
          </div>
        </div>
        <!-- 上传琥珀、下载天蓝，与上方卡片一致，不随主题变化 -->
        <TrafficChart :up="upHistory" :down="downHistory" up-color="#f59e0b" down-color="#0ea5e9" :height="240" />
      </section>

      <!-- 运行信息 -->
      <section class="card p-4">
        <h2 class="mb-3 font-semibold">运行信息</h2>
        <dl class="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          <div v-for="row in infoRows" :key="row.label" class="flex justify-between py-2.5">
            <dt class="text-slate-500">{{ row.label }}</dt>
            <dd class="font-medium tabular-nums">{{ row.value }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>
