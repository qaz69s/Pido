<script setup>
/**
 * 连接页
 * - WebSocket /connections?interval=1000 每秒推送完整快照
 * - 用前后两次快照的流量差计算每条连接的实时速率
 * - 快照中消失的连接移入「已关闭」（最多保留 MAX_CLOSED 条）
 * - 搜索、排序、暂停刷新、断开单条 / 全部、查看详情
 * - 桌面端表格，手机端卡片
 */
import { computed, reactive, ref, watch } from 'vue'
import { useStream } from '@/composables/useStream'
import { closeAllConnections, closeConnection } from '@/api/connections'
import { errorMessage } from '@/api/http'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { loadJSON, saveJSON } from '@/utils/storage'
import { formatBytes, formatSpeed, formatDuration, parseTime } from '@/utils/format'
import { connChain, connRule, connSearchText, connSource, connTarget } from '@/utils/connection'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import ConnectionDetail from '@/components/connection/ConnectionDetail.vue'

const INTERVAL = 1000 // 推送间隔（毫秒）
const MAX_CLOSED = 500 // 已关闭列表上限
const RENDER_STEP = 200 // 每次渲染的条数（连接很多时分批显示，避免卡顿）

const toast = useToastStore()
const confirm = useConfirmStore()

/* ---------- 数据 ---------- */
const active = ref([]) // 当前显示的活动连接（暂停时不更新）
const closed = ref([]) // 已关闭的连接（新的在前）
const totals = reactive({ upload: 0, download: 0 })
const now = ref(Date.now())
const paused = ref(false)
const received = ref(false) // 是否已收到第一条数据

let prevMap = new Map() // id → 上一次快照中的连接，用于计算速率
let prevTime = 0

const { status } = useStream('/connections', {
  query: { interval: INTERVAL },
  onMessage(d) {
    const t = Date.now()
    const seconds = prevTime ? Math.max(0.2, (t - prevTime) / 1000) : INTERVAL / 1000
    const list = d.connections || [] // 没有连接时后端返回 null
    const nextMap = new Map()

    const next = list.map((c) => {
      const p = prevMap.get(c.id)
      const item = {
        ...c,
        upSpeed: p ? Math.max(0, (c.upload - p.upload) / seconds) : 0,
        downSpeed: p ? Math.max(0, (c.download - p.download) / seconds) : 0,
        _search: connSearchText(c),
      }
      nextMap.set(c.id, item)
      return item
    })

    // 上次还在、这次没了 → 已关闭
    const gone = []
    for (const [id, c] of prevMap) {
      if (!nextMap.has(id)) gone.push({ ...c, upSpeed: 0, downSpeed: 0, closedAt: t })
    }
    if (gone.length) closed.value = [...gone, ...closed.value].slice(0, MAX_CLOSED)

    prevMap = nextMap
    prevTime = t
    totals.upload = d.uploadTotal ?? 0
    totals.download = d.downloadTotal ?? 0
    received.value = true
    if (!paused.value) {
      active.value = next
      now.value = t
    }
  },
})

/* ---------- 筛选与排序 ---------- */
const tab = ref('active') // active | closed
const keyword = ref('')

/** 排序偏好保存在本地 */
const sort = reactive({ key: 'start', desc: true, ...loadJSON('conn-sort', {}) })
watch(sort, (v) => saveJSON('conn-sort', v), { deep: true })

/** 手机端排序菜单 */
const sortMenu = ref(false)
function pickSort(key) {
  if (sort.key === key) sort.desc = !sort.desc
  else Object.assign(sort, { key, desc: true })
  sortMenu.value = false
}

const SORTS = [
  { key: 'start', label: '连接时间' },
  { key: 'downSpeed', label: '下载速率' },
  { key: 'upSpeed', label: '上传速率' },
  { key: 'download', label: '下载量' },
  { key: 'upload', label: '上传量' },
  { key: 'host', label: '主机' },
]

function sortValue(c, key) {
  if (key === 'start') return parseTime(c.start) || 0
  if (key === 'host') return connTarget(c).toLowerCase()
  return c[key] || 0
}

/** 点击表头切换排序：同一列再点则反向 */
function setSort(key) {
  if (sort.key === key) sort.desc = !sort.desc
  else Object.assign(sort, { key, desc: key !== 'host' })
}

const source = computed(() => (tab.value === 'active' ? active.value : closed.value))

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  // 支持空格分隔的多个关键词（全部命中才显示）
  const words = kw ? kw.split(/\s+/) : []
  let list = words.length
    ? source.value.filter((c) => {
        const text = c._search || connSearchText(c)
        return words.every((w) => text.includes(w))
      })
    : source.value
  // 已关闭列表默认按关闭时间排列，不参与排序
  if (tab.value === 'active') {
    const { key, desc } = sort
    list = [...list].sort((a, b) => {
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
      if (va === vb) return 0
      return (va > vb ? 1 : -1) * (desc ? -1 : 1)
    })
  }
  return list
})

/* 分批渲染 */
const renderLimit = ref(RENDER_STEP)
watch([tab, keyword], () => (renderLimit.value = RENDER_STEP))
const visible = computed(() => filtered.value.slice(0, renderLimit.value))

/** 当前列表的速率合计 */
const speedSum = computed(() =>
  active.value.reduce(
    (s, c) => ({ up: s.up + c.upSpeed, down: s.down + c.downSpeed }),
    { up: 0, down: 0 },
  ),
)

/* ---------- 操作 ---------- */
async function onClose(c) {
  try {
    await closeConnection(c.id)
    toast.success(`已断开 ${connTarget(c)}`)
    if (detail.value?.id === c.id) detail.value = null
  } catch (e) {
    toast.error(`断开失败：${errorMessage(e)}`)
  }
}

/** 有关键词时只断开筛选结果，否则断开全部 */
async function onCloseAll() {
  const kw = keyword.value.trim()
  const targets = kw ? filtered.value : active.value
  if (!targets.length) return
  const ok = await confirm.ask({
    title: kw ? `断开筛选出的 ${targets.length} 条连接？` : `断开全部 ${targets.length} 条连接？`,
    message: '正在进行的下载、视频等会中断，应用通常会自动重连。',
    confirmText: '断开',
    danger: true,
  })
  if (!ok) return
  try {
    if (kw) {
      const results = await Promise.allSettled(targets.map((c) => closeConnection(c.id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed) toast.warning(`已断开 ${targets.length - failed} 条，${failed} 条失败`)
      else toast.success(`已断开 ${targets.length} 条连接`)
    } else {
      await closeAllConnections()
      toast.success('已断开全部连接')
    }
  } catch (e) {
    toast.error(`操作失败：${errorMessage(e)}`)
  }
}

function clearClosed() {
  closed.value = []
}

/* ---------- 详情 ---------- */
const detail = ref(null)
const detailClosed = computed(() => !!detail.value?.closedAt)
// 详情打开时，跟随最新快照刷新流量数据
watch(active, (list) => {
  if (detail.value && !detail.value.closedAt) {
    const latest = list.find((c) => c.id === detail.value.id)
    if (latest) detail.value = latest
  }
})

/** 时长：活动连接算到现在，已关闭的算到关闭时刻 */
const duration = (c) => formatDuration(c.start, c.closedAt || now.value)

/** 桌面表格的列 */
const COLUMNS = [
  { key: 'host', label: '主机', sortable: true },
  { key: 'rule', label: '规则' },
  { key: 'chain', label: '链路' },
  { key: 'downSpeed', label: '下载速率', sortable: true, align: 'right' },
  { key: 'upSpeed', label: '上传速率', sortable: true, align: 'right' },
  { key: 'download', label: '下载量', sortable: true, align: 'right' },
  { key: 'upload', label: '上传量', sortable: true, align: 'right' },
  { key: 'start', label: '时长', sortable: true, align: 'right' },
  { key: 'source', label: '来源' },
]

const STATUS_TEXT = {
  connecting: '连接中…',
  reconnecting: '重连中…',
  error: '实时数据连接失败',
}
</script>

<template>
  <div class="space-y-3">
    <!-- 顶部统计 -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="card px-3 py-2.5">
        <div class="text-xs text-slate-500">活动连接</div>
        <div class="text-lg font-semibold">{{ active.length }}</div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-slate-500">实时速率 ↓ / ↑</div>
        <div class="truncate text-sm font-semibold leading-7">
          {{ formatSpeed(speedSum.down) }}
          <span class="font-normal text-slate-400">/</span>
          {{ formatSpeed(speedSum.up) }}
        </div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-slate-500">下载总量</div>
        <div class="text-lg font-semibold">{{ formatBytes(totals.download) }}</div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-slate-500">上传总量</div>
        <div class="text-lg font-semibold">{{ formatBytes(totals.upload) }}</div>
      </div>
    </div>

    <!-- 工具栏：标签与按钮一行不换行；手机上搜索框单独放在下一行 -->
    <div class="flex items-center gap-2">
      <div class="tb-tabs flex min-w-0 shrink overflow-hidden rounded-lg bg-slate-200/70 p-0.5 text-sm dark:bg-slate-800">
        <button
          v-for="t in [
            { key: 'active', label: '活动', count: active.length },
            { key: 'closed', label: '已关闭', count: closed.length },
          ]"
          :key="t.key"
          class="truncate whitespace-nowrap rounded-md transition"
          :class="tab === t.key ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'"
          @click="tab = t.key"
        >
          {{ t.label }} <span class="text-xs text-slate-400">{{ t.count }}</span>
        </button>
      </div>

      <div class="relative hidden min-w-0 flex-1 sm:block">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          v-model="keyword"
          class="input py-1.5 pl-8"
          placeholder="搜索主机、IP、进程、规则、节点（空格分隔多个词）"
          type="search"
        />
      </div>

      <div class="tb ml-auto flex shrink-0 items-center">
        <!-- 手机端排序：一个图标 + 小菜单（再点当前项切换升降序）；宽屏用表头排序 -->
        <div v-if="tab === 'active'" class="relative md:hidden">
          <button
            class="btn-icon"
            :class="sortMenu && 'bg-slate-200/70 dark:bg-slate-800'"
            title="排序"
            @click="sortMenu = !sortMenu"
          >
            <Icon name="sort" class="h-[18px] w-[18px]" />
          </button>
          <template v-if="sortMenu">
            <div class="fixed inset-0 z-20" @click="sortMenu = false" />
            <div class="card absolute right-0 top-full z-30 mt-1 w-44 p-1 shadow-lg">
              <button
                v-for="s in SORTS"
                :key="s.key"
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800"
                :class="sort.key === s.key ? 'font-medium' : 'text-slate-500'"
                @click="pickSort(s.key)"
              >
                {{ s.label }}
                <Icon v-if="sort.key === s.key" :name="sort.desc ? 'arrowDown' : 'arrowUp'" class="h-4 w-4" />
              </button>
            </div>
          </template>
        </div>
        <button
          class="btn-icon"
          :class="paused && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'"
          :title="paused ? '继续刷新' : '暂停刷新'"
          @click="paused = !paused"
        >
          <Icon :name="paused ? 'play' : 'pause'" class="h-[18px] w-[18px]" />
        </button>
        <button v-if="tab === 'active'" class="btn-danger" :disabled="!filtered.length" @click="onCloseAll">
          <Icon name="x" class="h-4 w-4" />
          <span class="hidden sm:inline">{{ keyword.trim() ? '断开筛选结果' : '全部断开' }}</span>
        </button>
        <button v-else class="btn-outline" :disabled="!closed.length" @click="clearClosed">
          <Icon name="trash" class="h-4 w-4" />
          <span class="hidden sm:inline">清空</span>
        </button>
      </div>
    </div>

    <!-- 手机端搜索框 -->
    <div class="relative sm:hidden">
      <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        v-model="keyword"
        class="input py-1.5 pl-8"
        placeholder="搜索主机、IP、进程、规则、节点（空格分隔多个词）"
        type="search"
      />
    </div>

    <!-- 状态提示 -->
    <div
      v-if="paused"
      class="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <Icon name="pause" class="h-4 w-4 shrink-0" />
      已暂停刷新，列表停在暂停时的状态。
    </div>
    <div
      v-else-if="STATUS_TEXT[status]"
      class="flex items-center gap-2 rounded-xl border p-2.5 text-sm"
      :class="
        status === 'error'
          ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200'
          : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900'
      "
    >
      <Icon :name="status === 'error' ? 'alert' : 'refresh'" class="h-4 w-4 shrink-0" :class="status !== 'error' && 'animate-spin'" />
      {{ STATUS_TEXT[status] }}
      <span v-if="status === 'error'" class="text-xs opacity-80">（检查后端地址和 secret，或刷新页面）</span>
    </div>

    <!-- 空状态 -->
    <div v-if="!received && status !== 'error'" class="space-y-2">
      <div v-for="i in 4" :key="i" class="card h-14 animate-pulse" />
    </div>
    <div v-else-if="!filtered.length" class="card">
      <EmptyState
        :icon="keyword ? 'search' : 'link'"
        :title="keyword ? '没有匹配的连接' : tab === 'active' ? '当前没有活动连接' : '还没有已关闭的连接'"
        :description="tab === 'closed' && !keyword ? '打开本页后断开的连接会出现在这里。' : ''"
      />
    </div>

    <template v-else>
      <!-- 桌面端：表格 -->
      <div class="card hidden overflow-x-auto md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800">
              <th
                v-for="col in COLUMNS"
                :key="col.key"
                class="whitespace-nowrap px-3 py-2.5 font-medium"
                :class="[col.align === 'right' && 'text-right', col.sortable && tab === 'active' && 'cursor-pointer select-none hover:text-slate-800 dark:hover:text-slate-200']"
                @click="col.sortable && tab === 'active' && setSort(col.key)"
              >
                {{ col.label }}
                <span v-if="tab === 'active' && sort.key === col.key" class="text-brand-500">{{ sort.desc ? '↓' : '↑' }}</span>
              </th>
              <th class="w-10 px-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
            <tr
              v-for="c in visible"
              :key="c.id"
              class="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
              @click="detail = c"
            >
              <td class="max-w-[16rem] px-3 py-2">
                <div class="truncate font-medium" :title="connTarget(c)">{{ connTarget(c) }}</div>
                <div class="mt-0.5 flex gap-1">
                  <span class="chip uppercase">{{ c.metadata?.network }}</span>
                  <span class="chip">{{ c.metadata?.type }}</span>
                </div>
              </td>
              <td class="max-w-[12rem] truncate px-3 py-2 text-slate-600 dark:text-slate-300" :title="connRule(c)">
                {{ connRule(c) }}
              </td>
              <td class="max-w-[14rem] truncate px-3 py-2 text-slate-600 dark:text-slate-300" :title="connChain(c).join(' → ')">
                {{ connChain(c).join(' → ') }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums" :class="c.downSpeed > 0 && 'text-brand-600 dark:text-brand-400'">
                {{ formatSpeed(c.downSpeed) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums" :class="c.upSpeed > 0 && 'text-amber-600 dark:text-amber-400'">
                {{ formatSpeed(c.upSpeed) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ formatBytes(c.download) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ formatBytes(c.upload) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">{{ duration(c) }}</td>
              <td class="max-w-[9rem] truncate px-3 py-2 text-slate-500" :title="connSource(c)">{{ connSource(c) }}</td>
              <td class="px-2 py-2">
                <button
                  v-if="tab === 'active'"
                  class="btn-icon h-7 w-7 text-slate-400 hover:text-rose-600"
                  title="断开"
                  @click.stop="onClose(c)"
                >
                  <Icon name="x" class="h-4 w-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 手机端：卡片 -->
      <div class="space-y-2 md:hidden">
        <div v-for="c in visible" :key="c.id" class="card p-3 active:bg-slate-50 dark:active:bg-slate-800/50" @click="detail = c">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ connTarget(c) }}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500">
                {{ connChain(c).join(' → ') }}
              </div>
            </div>
            <button
              v-if="tab === 'active'"
              class="btn-icon -mr-1 -mt-1 h-8 w-8 text-slate-400"
              title="断开"
              @click.stop="onClose(c)"
            >
              <Icon name="x" class="h-4 w-4" />
            </button>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span class="chip uppercase">{{ c.metadata?.network }}</span>
            <span class="max-w-[10rem] truncate">{{ connRule(c) }}</span>
            <span class="ml-auto tabular-nums">{{ duration(c) }}</span>
          </div>
          <div class="mt-1.5 grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div>
              <span class="text-brand-600 dark:text-brand-400">↓ {{ formatSpeed(c.downSpeed) }}</span>
              <span class="text-slate-400"> · {{ formatBytes(c.download) }}</span>
            </div>
            <div class="text-right">
              <span class="text-amber-600 dark:text-amber-400">↑ {{ formatSpeed(c.upSpeed) }}</span>
              <span class="text-slate-400"> · {{ formatBytes(c.upload) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载更多 -->
      <div v-if="filtered.length > visible.length" class="text-center">
        <button class="btn-outline" @click="renderLimit += RENDER_STEP">
          显示更多（剩余 {{ filtered.length - visible.length }} 条）
        </button>
      </div>
    </template>

    <ConnectionDetail
      :conn="detail"
      :closed="detailClosed"
      :now="now"
      @close="detail = null"
      @disconnect="onClose"
    />
  </div>
</template>
