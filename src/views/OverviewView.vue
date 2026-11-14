<script setup>
/**
 * 概览页
 * - /traffic    实时上下行速率（每秒一条）→ 曲线保留最近 60 秒
 * - /memory     内存占用
 * - /connections 活动连接数与累计流量
 * - GET /configs 运行模式、端口、TUN 状态
 * dae / honk（标准 API）：数据流由 ws.js 转为轮询 /runtime、/runtime/memory、/connections，
 *   运行信息改读 GET /api/v1/runtime（运行时长、数据面、配置代次、上次重载）
 * 本页在 App.vue 中被 KeepAlive 缓存，切走再回来曲线不会清空
 * 指标数字用 useTween 平滑滚动到新值，卡片首次进入依次浮现
 */
import { computed, reactive, ref, onMounted, onActivated } from 'vue'
import { useStream } from '@/composables/useStream'
import { useBackendStore } from '@/stores/backend'
import { getConfigs } from '@/api/configs'
import { getRuntime } from '@/api/standard/data'
import { formatBytes, formatSpeed, formatDuration, formatRelativeTime } from '@/utils/format'
import TrafficChart from '@/components/charts/TrafficChart.vue'
import Icon from '@/components/common/Icon.vue'
import { useTween } from '@/composables/useTween'

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
    // 标准 API 的快照带 total（列表可能被 limit 截断）；mihomo 没有 total，按列表长度
    conn.count = d.total ?? d.connections?.length ?? 0
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
/** 标准 API 的运行时汇总 */
const runtime = ref(null)
async function loadConfigs() {
  try {
    if (backend.isStandard) runtime.value = await getRuntime()
    else configs.value = await getConfigs()
  } catch {
    /* 连接异常由顶部 ErrorBanner 统一提示 */
  }
}
onMounted(loadConfigs)
onActivated(loadConfigs)

const MODE_LABEL = { rule: '规则', global: '全局', direct: '直连' }

/* ---------- 数字补间（显示值平滑过渡到最新值） ---------- */
const tUp = useTween(() => speed.up)
const tDown = useTween(() => speed.down)
const tUpTotal = useTween(() => conn.uploadTotal, { duration: 1200 })
const tDownTotal = useTween(() => conn.downloadTotal, { duration: 1200 })
const tMemory = useTween(() => memory.value)
const tCount = useTween(() => conn.count)

/** 标准 API 后端没有内存资源时隐藏「内存占用」卡片 */
const showMemory = computed(
  () => !backend.isStandard || (memoryStream.status.value !== 'unsupported' && backend.supports('runtime_memory')),
)

const allStats = computed(() => [
  { label: '上传速率', value: formatSpeed(tUp.value), icon: 'arrowUp', color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  { label: '下载速率', value: formatSpeed(tDown.value), icon: 'arrowDown', color: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
  { label: '上传总量', value: formatBytes(tUpTotal.value), icon: 'upload', color: 'text-amber-600/80 dark:text-amber-400/80 bg-amber-500/5' },
  { label: '下载总量', value: formatBytes(tDownTotal.value), icon: 'download', color: 'text-sky-600/80 dark:text-sky-400/80 bg-sky-500/5' },
  { label: '内存占用', value: formatBytes(tMemory.value), icon: 'cpu', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  { label: '活动连接', value: String(Math.round(tCount.value)), icon: 'link', color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
])
const stats = computed(() => (showMemory.value ? allStats.value : allStats.value.filter((s) => s.icon !== 'cpu')))

const DATAPATH_STATE = { active: '运行中', degraded: '降级', inactive: '未启用', starting: '启动中', stopped: '已停止', failed: '失败' }
const RELOAD_STATUS = { succeeded: '成功', failed: '失败', running: '进行中', queued: '排队中' }

/** 标准 API 的运行信息 */
const standardRows = computed(() => {
  const r = runtime.value
  const dp = r?.datapath
  const lr = r?.last_reload
  return [
    { label: '内核版本', value: backend.label || '--' },
    { label: '运行时长', value: r?.lifecycle?.started_at ? formatDuration(r.lifecycle.started_at) : '--' },
    {
      label: '数据面',
      value: dp ? `${dp.kind === 'ebpf' ? 'eBPF' : dp.kind || ''} · ${DATAPATH_STATE[dp.state] || dp.state || '--'}` : '--',
    },
    { label: '配置代次', value: r?.generation?.active_id ?? '--' },
    {
      label: '上次重载',
      value: lr ? `${RELOAD_STATUS[lr.status] || lr.status}${lr.finished_at ? ` · ${formatRelativeTime(lr.finished_at)}` : ''}` : '--',
    },
  ]
})

const infoRows = computed(() => {
  if (backend.isStandard) return standardRows.value
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

    <!-- 指标卡片
      - 列数：手机 2 列，平板 / 常见桌面 3 列，超宽屏（2xl）才排成一行，避免 1280 左右的桌面上数值被截断
      - 卡片内部用容器查询（style.css 的 .stat-tile）：卡片较窄时图标与标签同行、数值独占一行，
        手机系统字体放大到 150% 时数值也不会被截断 -->
    <div class="stagger grid grid-cols-2 gap-3 sm:grid-cols-3" :class="stats.length === 5 ? '2xl:grid-cols-5' : '2xl:grid-cols-6'">
      <div v-for="s in stats" :key="s.label" class="card stat-tile p-3">
        <div class="stat-body">
          <span class="stat-icon grid shrink-0 place-items-center rounded-xl" :class="s.color">
            <Icon :name="s.icon" class="h-[18px] w-[18px]" />
          </span>
          <div class="stat-label truncate text-xs text-slate-500">{{ s.label }}</div>
          <div class="stat-value whitespace-nowrap text-[17px] font-semibold tabular-nums">{{ s.value }}</div>
        </div>
      </div>
    </div>

    <div class="stagger grid gap-3 lg:grid-cols-3">
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
