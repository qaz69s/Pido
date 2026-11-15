<script setup>
/**
 * 连接页
 * - WebSocket /connections?interval=1000 每秒推送完整快照
 * - 用前后两次快照的流量差计算每条连接的实时速率
 * - 快照中消失的连接移入「已关闭」（最多保留 MAX_CLOSED 条）
 * - 搜索、排序、暂停刷新、断开单条 / 全部、查看详情
 * - 桌面端表格，手机端卡片
 * dae / honk（标准 API）：由 ws.js 改为每秒轮询 GET /api/v1/connections，快照形状相同；
 *   每条连接自带速率（upRate / downRate），累计流量可能为 null（UDP、内核直连），显示 "--"
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
        // 后端直接给出速率时用后端的（标准 API），否则用两次快照的流量差计算（mihomo）
        upSpeed: c.upRate ?? (p ? Math.max(0, (c.upload - p.upload) / seconds) : 0),
        downSpeed: c.downRate ?? (p ? Math.max(0, (c.download - p.download) / seconds) : 0),
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

/** 流量：null 表示后端不统计这条连接（标准 API），显示 "--" */
const bytes = (v) => (v === null ? '--' : formatBytes(v))

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
  <div class="space-y-3 tabular-nums">
    <!-- 顶部统计 -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="card px-3 py-2.5">
        <div class="text-xs text-base-content/70">活动连接</div>
        <div class="text-2xl font-bold tracking-tight sm:text-stat">{{ active.length }}</div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-base-content/70">实时速率 ↓ / ↑</div>
        <div class="truncate py-1 text-base font-semibold leading-7 sm:py-0.5">
          {{ formatSpeed(speedSum.down) }}
          <span class="font-normal text-base-content/60">/</span>
          {{ formatSpeed(speedSum.up) }}
        </div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-base-content/70">下载总量</div>
        <div class="text-2xl font-bold tracking-tight sm:text-stat">{{ formatBytes(totals.download) }}</div>
      </div>
      <div class="card px-3 py-2.5">
        <div class="text-xs text-base-content/70">上传总量</div>
        <div class="text-2xl font-bold tracking-tight sm:text-stat">{{ formatBytes(totals.upload) }}</div>
      </div>
    </div>

    <!-- 工具栏：标签与按钮一行不换行；手机上搜索框单独放在下一行 -->
    <div class="flex items-center gap-2">
      <div role="tablist" class="tb-tabs tabs tabs-boxed tabs-sm min-w-0 shrink overflow-hidden">
        <button
          v-for="t in [
            { key: 'active', label: '活动', count: active.length },
            { key: 'closed', label: '已关闭', count: closed.length },
          ]"
          :key="t.key"
          role="tab"
          class="tab truncate whitespace-nowrap"
          :class="tab === t.key && 'tab-active font-medium'"
          @click="tab = t.key"
        >
          {{ t.label }} <span class="tab-count text-xs opacity-60">{{ t.count }}</span>
        </button>
      </div>

      <div class="relative hidden min-w-0 flex-1 sm:block">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60" />
        <input
          v-model="keyword"
          class="input input-bordered input-sm w-full pl-8"
          placeholder="搜索主机、IP、进程、规则、节点（空格分隔多个词）"
          type="search"
        />
      </div>

      <div class="tb ml-auto flex shrink-0 items-center">
        <!-- 手机端排序：一个图标 + 小菜单（再点当前项切换升降序）；宽屏用表头排序 -->
        <div v-if="tab === 'active'" class="dropdown dropdown-end md:hidden" :class="sortMenu && 'dropdown-open'">
          <button
            class="btn btn-sm btn-ghost btn-square size-9"
            :class="sortMenu && 'btn-active'"
            title="排序"
            @click="sortMenu = !sortMenu"
          >
            <Icon name="sort" class="h-5 w-5" />
          </button>
          <template v-if="sortMenu">
            <div class="fixed inset-0 z-20" @click="sortMenu = false" />
            <ul class="dropdown-content menu z-30 mt-1 w-44 rounded-box border border-line bg-base-100 p-1 shadow-lg">
              <li v-for="s in SORTS" :key="s.key">
                <button
                  class="flex items-center justify-between"
                  :class="sort.key === s.key ? 'font-medium' : 'text-base-content/70'"
                  @click="pickSort(s.key)"
                >
                  {{ s.label }}
                  <Icon v-if="sort.key === s.key" :name="sort.desc ? 'arrowDown' : 'arrowUp'" class="h-4 w-4" />
                </button>
              </li>
            </ul>
          </template>
        </div>
        <button
          class="btn btn-sm btn-ghost btn-square size-9"
          :class="paused && 'bg-warning/10 text-warning'"
          :title="paused ? '继续刷新' : '暂停刷新'"
          @click="paused = !paused"
        >
          <Icon :name="paused ? 'play' : 'pause'" class="h-5 w-5" />
        </button>
        <button v-if="tab === 'active'" class="btn btn-sm btn-error" :disabled="!filtered.length" @click="onCloseAll">
          <Icon name="x" class="h-4 w-4" />
          <span class="hidden sm:inline">{{ keyword.trim() ? '断开筛选结果' : '全部断开' }}</span>
        </button>
        <button v-else class="btn btn-sm btn-outline border-line-strong" :disabled="!closed.length" @click="clearClosed">
          <Icon name="trash" class="h-4 w-4" />
          <span class="hidden sm:inline">清空</span>
        </button>
      </div>
    </div>

    <!-- 手机端搜索框 -->
    <div class="relative sm:hidden">
      <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60" />
      <input
        v-model="keyword"
        class="input input-bordered input-sm w-full pl-8"
        placeholder="搜索主机、IP、进程、规则、节点（空格分隔多个词）"
        type="search"
      />
    </div>

    <!-- 状态提示 -->
    <div
      v-if="paused"
      class="alert flex items-center gap-2 px-3 py-2.5 text-left text-sm text-base-content/80"
    >
      <Icon name="pause" class="h-4 w-4 shrink-0 text-warning" />
      已暂停刷新，列表停在暂停时的状态。
    </div>
    <div
      v-else-if="STATUS_TEXT[status]"
      class="alert flex items-center gap-2 rounded-xl p-2.5 text-left text-sm"
      :class="
        status === 'error'
          ? 'border-error/30 bg-error/10 text-error'
          : 'border-transparent bg-base-200 text-base-content/70'
      "
    >
      <Icon v-if="status === 'error'" name="alert" class="h-4 w-4 shrink-0" />
      <span v-else class="loading loading-spinner loading-xs shrink-0" />
      {{ STATUS_TEXT[status] }}
      <span v-if="status === 'error'" class="text-xs opacity-80">（检查后端地址和 secret，或刷新页面）</span>
    </div>

    <!-- 空状态 -->
    <div v-if="!received && status !== 'error'" class="space-y-2">
      <div v-for="i in 4" :key="i" class="skeleton h-14" />
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
        <table class="table table-sm [&_tr]:border-line">
          <thead>
            <tr class="text-left text-xs text-base-content/70">
              <th
                v-for="col in COLUMNS"
                :key="col.key"
                class="whitespace-nowrap px-3 py-2.5 font-medium"
                :class="[col.align === 'right' && 'text-right', col.sortable && tab === 'active' && 'cursor-pointer select-none hover:text-base-content']"
                @click="col.sortable && tab === 'active' && setSort(col.key)"
              >
                {{ col.label }}
                <span v-if="tab === 'active' && sort.key === col.key" class="text-primary">{{ sort.desc ? '↓' : '↑' }}</span>
              </th>
              <th class="w-10 px-2" />
            </tr>
          </thead>
          <!-- 新连接滑入、关闭的淡出；切换标签时整体重建（:key），避免大量动画 -->
          <TransitionGroup :key="tab" tag="tbody" name="conn">
            <tr
              v-for="c in visible"
              :key="c.id"
              class="hover cursor-pointer transition"
              @click="detail = c"
            >
              <td class="max-w-[16rem] px-3 py-2">
                <div class="truncate font-medium" :title="connTarget(c)">{{ connTarget(c) }}</div>
                <div class="mt-0.5 flex gap-1">
                  <span class="badge badge-ghost badge-sm text-base-content/70 uppercase">{{ c.metadata?.network }}</span>
                  <span class="badge badge-ghost badge-sm text-base-content/70">{{ c.metadata?.type }}</span>
                </div>
              </td>
              <td class="max-w-[12rem] truncate px-3 py-2 text-base-content/80" :title="connRule(c)">
                {{ connRule(c) }}
              </td>
              <td class="max-w-[14rem] truncate px-3 py-2 text-base-content/80" :title="connChain(c).join(' → ')">
                {{ connChain(c).join(' → ') }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums" :class="c.downSpeed > 0 && 'text-primary'">
                {{ formatSpeed(c.downSpeed) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums" :class="c.upSpeed > 0 && 'text-warning'">
                {{ formatSpeed(c.upSpeed) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ bytes(c.download) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ bytes(c.upload) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums text-base-content/70">{{ duration(c) }}</td>
              <td class="max-w-[9rem] truncate px-3 py-2 text-base-content/70" :title="connSource(c)">{{ connSource(c) }}</td>
              <td class="px-2 py-2">
                <button
                  v-if="tab === 'active'"
                  class="btn btn-xs btn-ghost btn-square h-7 w-7 text-base-content/60 hover:text-error"
                  title="断开"
                  @click.stop="onClose(c)"
                >
                  <Icon name="x" class="h-4 w-4" />
                </button>
              </td>
            </tr>
          </TransitionGroup>
        </table>
      </div>

      <!-- 手机端：卡片 -->
      <TransitionGroup :key="tab" tag="div" name="conn" class="space-y-2 md:hidden">
        <div v-for="c in visible" :key="c.id" class="card p-3 active:bg-base-200" @click="detail = c">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ connTarget(c) }}</div>
              <div class="mt-0.5 truncate text-xs text-base-content/70">
                {{ connChain(c).join(' → ') }}
              </div>
            </div>
            <button
              v-if="tab === 'active'"
              class="btn btn-sm btn-ghost btn-square -mr-1 -mt-1 h-8 w-8 text-base-content/60"
              title="断开"
              @click.stop="onClose(c)"
            >
              <Icon name="x" class="h-4 w-4" />
            </button>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
            <span class="badge badge-ghost badge-sm text-base-content/70 uppercase">{{ c.metadata?.network }}</span>
            <span class="max-w-[10rem] truncate">{{ connRule(c) }}</span>
            <span class="ml-auto tabular-nums">{{ duration(c) }}</span>
          </div>
          <div class="mt-1.5 grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div>
              <span class="text-primary">↓ {{ formatSpeed(c.downSpeed) }}</span>
              <span class="text-base-content/60"> · {{ bytes(c.download) }}</span>
            </div>
            <div class="text-right">
              <span class="text-warning">↑ {{ formatSpeed(c.upSpeed) }}</span>
              <span class="text-base-content/60"> · {{ bytes(c.upload) }}</span>
            </div>
          </div>
        </div>
      </TransitionGroup>

      <!-- 加载更多 -->
      <div v-if="filtered.length > visible.length" class="text-center">
        <button class="btn btn-sm btn-outline border-line-strong" @click="renderLimit += RENDER_STEP">
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
