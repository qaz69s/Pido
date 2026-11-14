<script setup>
/**
 * 代理页
 * Tab 1「代理组」：按 GLOBAL 中的顺序展示代理组，点击节点切换，单节点 / 整组 / 全部测速
 * Tab 2「代理集合」：proxy-providers 列表，显示订阅流量与到期时间，支持更新和健康检查
 * dae / honk（标准 API）：数据由 api/standard/proxies.js 整理成相同形状；
 *   只有 selector 组可点选，测速走 /probes（测速地址由后端配置决定），
 *   Tab 2 显示 /providers（订阅可刷新，inline / file 只读，没有健康检查）
 *   节点管理（开启 config_write 时）：订阅页工具栏「添加节点」、各来源卡片「节点」→ NodeManager
 *   （内联节点可添加 / 改名换链接 / 删除，订阅节点只读）；可调参数的组在卡片标题栏有「组参数」按钮 → GroupParamsDialog
 */
import { computed, reactive, ref, watch, onMounted } from 'vue'
import {
  getProxies,
  selectProxy,
  testProxyDelay,
  testGroupDelay,
  getProxyProviders,
  updateProxyProvider,
  healthcheckProxyProvider,
  DEFAULT_TEST_URL,
} from '@/api/proxies'
import { getConfigs } from '@/api/configs'
import { getConnections, closeConnection } from '@/api/connections'
import { describeError, errorMessage } from '@/api/http'
import { useToastStore } from '@/stores/toast'
import { useBackendStore } from '@/stores/backend'
import { useDelayStore, latestFromBackend } from '@/stores/delays'
import { loadJSON, saveJSON } from '@/utils/storage'
import { formatBytes, formatDate, formatRelativeTime } from '@/utils/format'
import { getWriteCaps } from '@/api/standard/manage'
import ProxyGroupCard from '@/components/proxy/ProxyGroupCard.vue'
import NodeManager from '@/components/proxy/NodeManager.vue'
import GroupParamsDialog from '@/components/proxy/GroupParamsDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import Switch from '@/components/common/Switch.vue'

const toast = useToastStore()
const backend = useBackendStore()
const delayStore = useDelayStore()

/* ---------- 状态 ---------- */
const proxies = ref({}) // GET /proxies 的结果
const providers = ref({}) // GET /providers/proxies 的结果

/**
 * 节点查找表：/proxies 只包含配置文件里的节点和策略组，
 * 来自 proxy-providers（订阅）的节点不在其中，需要从 /providers/proxies 合并进来，
 * 否则节点卡片拿不到协议类型（type）
 */
const allProxies = computed(() => {
  const map = {}
  for (const pv of Object.values(providers.value)) {
    for (const n of pv.proxies || []) map[n.name] = n
  }
  return Object.assign(map, proxies.value)
})
const mode = ref('rule')
const loading = ref(true)
const loadError = ref(null)
const tab = ref('groups') // groups | providers

/**
 * 显示用的延迟表 { 名称: 延迟ms，0=超时 }，来自全局延迟缓存；
 * 策略组跟随它当前选中的节点，所以子策略组也能显示延迟
 */
const delays = computed(() => {
  const all = proxies.value
  const out = {}
  for (const name of Object.keys(all)) {
    const d = delayStore.get(name, all)
    if (d !== undefined) out[name] = d
  }
  for (const name of Object.keys(delayStore.map)) if (!(name in out)) out[name] = delayStore.map[name].delay
  return out
})
const testingNodes = reactive({}) // { 节点名: true }
const testingGroups = reactive({}) // { 组名: true }
const busyProviders = reactive({}) // { 集合名: 'update' | 'check' }

/** 本页偏好（保存在 localStorage） */
const prefs = reactive({
  testUrl: DEFAULT_TEST_URL,
  timeout: 5000,
  sort: 'default',
  closeOnSwitch: false, // 切换节点后断开仍走旧节点的连接
  collapsed: {},
  ...loadJSON('proxy-prefs', {}),
})
watch(prefs, (v) => saveJSON('proxy-prefs', v), { deep: true })
const showSettings = ref(false)
const testOpts = () => ({ url: prefs.testUrl || DEFAULT_TEST_URL, timeout: Number(prefs.timeout) || 5000 })

/* ---------- 数据加载 ---------- */

/** 标准 API 的写入能力（节点管理、组参数）；mihomo 为 null */
const writeCaps = ref(null)
async function loadWriteCaps() {
  writeCaps.value = backend.isStandard ? await getWriteCaps({ force: true }).catch(() => null) : null
}

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  if (backend.isStandard) loadWriteCaps()
  try {
    const [p, pp, c] = await Promise.all([
      getProxies(),
      getProxyProviders().catch(() => ({ providers: {} })), // 老版本内核可能没有此接口
      getConfigs().catch(() => null),
    ])
    proxies.value = p?.proxies || {}
    providers.value = pp?.providers || {}
    if (c?.mode) mode.value = c.mode.toLowerCase()
    // 后端自动测速 / 健康检查的结果（history 与 extra 中较新的一条）
    delayStore.syncFromProxies(proxies.value)
    for (const pv of Object.values(providers.value)) {
      for (const n of pv.proxies || []) {
        const b = latestFromBackend(n)
        if (b && (!delayStore.map[n.name] || b.t >= delayStore.map[n.name].t)) delayStore.map[n.name] = b
      }
    }
    loadError.value = null
  } catch (e) {
    loadError.value = e
    if (silent) toast.error(`刷新失败：${errorMessage(e)}`)
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ---------- 代理组 ---------- */
/**
 * 代理组顺序：mihomo 的 GLOBAL.all 里保留了配置文件中 proxy-groups 的顺序
 * - 过滤掉 hidden 的组
 * - GLOBAL 只在全局模式下显示（置顶）
 */
const groups = computed(() => {
  const all = proxies.value
  const isGroup = (n) => n !== 'GLOBAL' && Array.isArray(all[n]?.all) && !all[n].hidden
  const ordered = (all.GLOBAL?.all || []).filter(isGroup)
  const rest = Object.keys(all).filter((n) => isGroup(n) && !ordered.includes(n))
  const list = [...ordered, ...rest].map((n) => all[n])
  if (mode.value === 'global' && all.GLOBAL) list.unshift(all.GLOBAL)
  return list
})

async function onSelect(group, name) {
  try {
    await selectProxy(group.name, name)
    proxies.value[group.name] = { ...proxies.value[group.name], now: name }
    const closed = prefs.closeOnSwitch ? await closeOldConnections(group.name, name) : 0
    toast.success(`${group.name} → ${name}${closed ? `，已断开 ${closed} 条旧连接` : ''}`)
    // 嵌套组的 now 可能联动变化，静默刷新一次
    load({ silent: true })
  } catch (e) {
    toast.error(`切换失败：${errorMessage(e)}`)
  }
}

/**
 * 切换后断开旧连接：经过该组、但链路里没有新节点的连接（chains 为 [节点, …, 组]）
 * 已建立的长连接（如 Telegram、游戏、下载）不会自动换线，断开后客户端重连就会走新节点
 * 返回成功断开的条数；失败只提示不抛错（切换本身已成功）
 */
async function closeOldConnections(groupName, newName) {
  try {
    const snap = await getConnections()
    const ids = (snap?.connections || [])
      .filter((c) => Array.isArray(c.chains) && c.chains.includes(groupName) && !c.chains.includes(newName))
      .map((c) => c.id)
    const res = await Promise.allSettled(ids.map((id) => closeConnection(id)))
    return res.filter((r) => r.status === 'fulfilled').length
  } catch (e) {
    toast.error(`断开旧连接失败：${errorMessage(e)}`)
    return 0
  }
}

/** 单节点测速；后端在超时/失败时返回 408/504/503，统一记为“超时” */
/** 节点所在的 proxy-provider 名称；配置文件里直接定义的节点返回 undefined */
function providerOf(name) {
  if (proxies.value[name]) return undefined
  for (const [pname, pv] of Object.entries(providers.value)) {
    if ((pv.proxies || []).some((n) => n.name === name)) return pv.name || pname
  }
  return undefined
}

async function onTestNode(name) {
  testingNodes[name] = true
  try {
    const res = await testProxyDelay(name, { ...testOpts(), provider: providerOf(name) })
    delayStore.set(name, res?.delay ?? 0)
  } catch (e) {
    if ([408, 503, 504].includes(e.status)) delayStore.set(name, 0)
    else toast.error(`${name} 测速失败：${errorMessage(e)}`)
  } finally {
    delete testingNodes[name]
  }
}

/** 整组测速：GET /group/{name}/delay，结果里没有的节点视为超时 */
async function onTestGroup(group, { quiet = false } = {}) {
  testingGroups[group.name] = true
  try {
    const res = (await testGroupDelay(group.name, testOpts())) || {}
    // 结果里没有的节点视为超时；成员是策略组的跳过（它跟随自己的当前节点显示）
    for (const n of group.all || []) {
      if (Array.isArray(proxies.value[n]?.all)) continue
      delayStore.set(n, res[n] ?? 0)
    }
    if (!quiet) toast.success(`${group.name} 测速完成`)
  } catch (e) {
    if (!quiet) toast.error(`${group.name} 测速失败：${errorMessage(e)}`)
    throw e
  } finally {
    delete testingGroups[group.name]
  }
}

const testingAll = ref(false)
async function onTestAll() {
  testingAll.value = true
  const results = await Promise.allSettled(groups.value.map((g) => onTestGroup(g, { quiet: true })))
  testingAll.value = false
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) toast.warning(`测速完成，${failed} 个组失败`)
  else toast.success('全部测速完成')
  load({ silent: true }) // url-test / fallback 组可能因此切换了节点
}

function toggleGroup(name) {
  prefs.collapsed = { ...prefs.collapsed, [name]: !prefs.collapsed[name] }
}
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every((g) => prefs.collapsed[g.name]))
function toggleAll() {
  const target = !allCollapsed.value
  prefs.collapsed = Object.fromEntries(groups.value.map((g) => [g.name, target]))
}

/* ---------- 代理集合（proxy-providers） ---------- */
/** 过滤掉内置的 default（vehicleType 为 Compatible，代表配置文件里直接写的 proxies） */
const providerList = computed(() =>
  Object.values(providers.value).filter((p) => p.vehicleType !== 'Compatible'),
)
/** 可以更新的集合（标准 API 只有订阅能刷新；mihomo 全部可以） */
const updatableProviders = computed(() => providerList.value.filter((p) => p._canUpdate !== false))

function subscription(p) {
  const s = p.subscriptionInfo
  if (!s || !s.Total) return null
  const used = (s.Upload || 0) + (s.Download || 0)
  return {
    used: formatBytes(used),
    total: formatBytes(s.Total),
    percent: Math.min(100, (used / s.Total) * 100),
    expire: s.Expire ? formatDate(s.Expire) : '长期有效',
  }
}

async function onUpdateProvider(name, { quiet = false } = {}) {
  busyProviders[name] = 'update'
  try {
    await updateProxyProvider(name)
    if (!quiet) toast.success(`${name} 已更新`)
  } catch (e) {
    if (!quiet) toast.error(`${name} 更新失败：${errorMessage(e)}`)
    throw e
  } finally {
    delete busyProviders[name]
  }
  if (!quiet) load({ silent: true })
}

async function onHealthcheck(name) {
  busyProviders[name] = 'check'
  try {
    await healthcheckProxyProvider(name)
    toast.success(`${name} 健康检查完成`)
    await load({ silent: true }) // 结果写在各节点的 history 里
  } catch (e) {
    toast.error(`${name} 健康检查失败：${errorMessage(e)}`)
  } finally {
    delete busyProviders[name]
  }
}

const updatingAll = ref(false)
async function onUpdateAllProviders() {
  updatingAll.value = true
  const results = await Promise.allSettled(updatableProviders.value.map((p) => onUpdateProvider(p.name, { quiet: true })))
  updatingAll.value = false
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) toast.warning(`更新完成，${failed} 个失败`)
  else toast.success(backend.isStandard ? '全部订阅已更新' : '全部代理集合已更新')
  load({ silent: true })
}

/** 集合内节点的平均延迟（只算有效值），用于卡片概览 */
function providerStats(p) {
  const list = p.proxies || []
  const valid = list.map((n) => delays.value[n.name] ?? latestFromBackend(n)?.delay).filter((d) => d > 0)
  return {
    count: list.length,
    alive: valid.length,
    avg: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null,
  }
}

/* ---------- 节点管理 / 组参数（标准 API） ---------- */
const canManageNodes = computed(() => backend.isStandard && !!writeCaps.value?.nodesManage)
const nodeDialog = reactive({ open: false, mode: 'list', provider: null })
function openNodes(p) {
  nodeDialog.provider = p
  nodeDialog.mode = 'list'
  nodeDialog.open = true
}
function openAddNode() {
  // 新节点写入内联来源（node 段）：有内联来源卡片时一起带上，添加完回到它的列表
  nodeDialog.provider = providerList.value.find((p) => p._kind === 'inline') || null
  nodeDialog.mode = 'add'
  nodeDialog.open = true
}
// 列表打开期间数据刷新：弹窗里的来源跟着换成最新的对象
watch(providers, () => {
  if (nodeDialog.provider) nodeDialog.provider = providerList.value.find((p) => p._id === nodeDialog.provider._id) || nodeDialog.provider
})

/** 组是否可调参数：后端允许组配置补丁，且该组的 mutable_config 含 check_interval / tolerance */
function groupConfigurable(g) {
  if (!backend.isStandard || !writeCaps.value?.groupPatch) return false
  const m = g._mutable || []
  return m.includes('check_interval') || (m.includes('tolerance') && g._policy === 'urltest')
}
const groupDialog = reactive({ open: false, group: null })
function openGroupParams(g) {
  groupDialog.group = g
  groupDialog.open = true
}

const loadErrorInfo = computed(() => (loadError.value ? describeError(loadError.value) : null))
</script>

<template>
  <!-- stagger：代理组卡片首次出现时依次浮现 -->
  <div class="stagger space-y-3">
    <!-- 工具栏：不换行，空间不够时标签先收缩（手机系统字体放大时也保持一行） -->
    <div class="flex items-center gap-2">
      <div class="tb-tabs flex min-w-0 shrink overflow-hidden rounded-lg bg-slate-200/70 p-0.5 text-sm dark:bg-slate-800">
        <button
          v-for="t in [
            { key: 'groups', label: '代理组', count: groups.length },
            { key: 'providers', label: backend.isStandard ? '订阅' : '代理集合', count: providerList.length },
          ]"
          :key="t.key"
          class="truncate whitespace-nowrap rounded-md transition"
          :class="tab === t.key ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'"
          @click="tab = t.key"
        >
          {{ t.label }} <span class="tab-count text-xs text-slate-400">{{ t.count }}</span>
        </button>
      </div>

      <!-- 工具栏：图标按钮在前，主操作（全部测速 / 全部更新）固定在最右 -->
      <div class="tb ml-auto flex shrink-0 items-center gap-0.5 rounded-xl bg-tile p-0.5">
        <template v-if="tab === 'groups'">
          <button class="btn-icon" :title="allCollapsed ? '全部展开' : '全部折叠'" @click="toggleAll">
            <Icon name="chevronDown" class="h-5 w-5 transition-transform" :class="allCollapsed ? '' : 'rotate-180'" />
          </button>
          <button
            class="btn-icon"
            :class="showSettings && 'bg-slate-200/70 dark:bg-slate-800'"
            title="显示与测速设置"
            @click="showSettings = !showSettings"
          >
            <Icon name="settings" class="h-5 w-5" />
          </button>
        </template>
        <template v-else>
          <button v-if="canManageNodes" class="btn-icon" title="通过分享链接添加节点" @click="openAddNode">
            <Icon name="plus" class="h-5 w-5" />
          </button>
        </template>
        <button class="btn-icon" title="重新载入" @click="load({ silent: true })">
          <Icon name="reload" class="h-5 w-5" />
        </button>
        <button
          v-if="tab === 'groups'"
          class="btn-icon bg-brand-500/15 text-brand-600 dark:text-brand-300 sm:w-auto sm:gap-1.5 sm:px-3"
          title="全部测速"
          :disabled="testingAll || !groups.length"
          @click="onTestAll"
        >
          <Icon name="gauge" class="h-5 w-5" :class="testingAll && 'animate-pulse'" />
          <span class="hidden sm:inline">{{ testingAll ? '测速中…' : '全部测速' }}</span>
        </button>
        <button
          v-else
          class="btn-icon bg-brand-500/15 text-brand-600 dark:text-brand-300 sm:w-auto sm:gap-1.5 sm:px-3"
          title="全部更新订阅"
          :disabled="updatingAll || !updatableProviders.length"
          @click="onUpdateAllProviders"
        >
          <Icon name="cloudDown" class="h-5 w-5" :class="updatingAll && 'animate-pulse'" />
          <span class="hidden sm:inline">全部更新</span>
        </button>
      </div>
    </div>

    <!-- 显示与测速设置（排序收在这里，手机上工具栏才能放在一行） -->
    <div
      v-if="showSettings && tab === 'groups'"
      class="card grid gap-3 p-4 sm:items-end"
      :class="backend.isStandard ? 'sm:grid-cols-[9rem_1fr_auto]' : 'sm:grid-cols-[9rem_1fr_10rem_auto]'"
    >
      <div>
        <label class="label">节点排序</label>
        <select v-model="prefs.sort" class="input">
          <option value="default">默认顺序</option>
          <option value="delay">按延迟</option>
          <option value="name">按名称</option>
        </select>
      </div>
      <template v-if="!backend.isStandard">
        <div>
          <label class="label">测速地址</label>
          <input v-model.trim="prefs.testUrl" class="input font-mono" :placeholder="DEFAULT_TEST_URL" />
        </div>
        <div>
          <label class="label">超时（毫秒）</label>
          <input v-model.number="prefs.timeout" type="number" min="500" step="500" class="input" />
        </div>
      </template>
      <!-- 标准 API：测速由后端发起，地址取各组的 check_url / 节点配置 -->
      <p v-else class="flex items-start gap-1.5 text-xs text-slate-500 sm:pb-2.5">
        <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
        测速由 {{ backend.engine }} 发起（HTTP 探测），测速地址与超时取后端配置
      </p>
      <button class="btn-outline" @click="prefs.testUrl = DEFAULT_TEST_URL; prefs.timeout = 5000; prefs.sort = 'default'; prefs.closeOnSwitch = false">恢复默认</button>
      <!-- 切换节点时断开旧连接 -->
      <label class="col-span-full flex cursor-pointer items-center justify-between gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/60">
        <span class="min-w-0">
          <span class="block text-sm font-medium">切换节点时断开旧连接</span>
          <span class="block text-xs text-slate-500">已建立的连接不会自动换线；开启后切换即断开走旧节点的连接，应用重连后走新节点</span>
        </span>
        <Switch v-model="prefs.closeOnSwitch" />
      </label>
    </div>

    <div
      v-if="mode === 'direct' && tab === 'groups'"
      class="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
    >
      <Icon name="info" class="h-4 w-4 shrink-0" />
      当前为直连模式，代理组的选择暂不生效。
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="grid gap-3 lg:grid-cols-2">
      <div v-for="i in 4" :key="i" class="card skeleton h-20" />
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadErrorInfo" class="card">
      <EmptyState icon="alert" :title="loadErrorInfo.title" :tips="loadErrorInfo.tips">
        <button class="btn-primary" @click="load()">重试</button>
        <RouterLink to="/setup" class="btn-outline">修改设置</RouterLink>
      </EmptyState>
    </div>

    <!-- 代理组 -->
    <template v-else-if="tab === 'groups'">
      <div v-if="!groups.length" class="card">
        <EmptyState icon="globe" title="没有代理组" :description="backend.isStandard ? '后端配置中没有定义策略组（group）。' : '配置文件中未定义 proxy-groups。'" />
      </div>
      <!-- 桌面端（lg 以上）两列排布，手机/平板保持单列；items-start 让左右卡片各自高度 -->
      <div v-else class="grid items-start gap-3 lg:grid-cols-2">
      <ProxyGroupCard
        v-for="g in groups"
        :key="g.name"
        :group="g"
        :proxies="allProxies"
        :delays="delays"
        :testing-nodes="testingNodes"
        :testing="!!testingGroups[g.name]"
        :collapsed="!!prefs.collapsed[g.name]"
        :sort="prefs.sort"
        :configurable="groupConfigurable(g)"
        @toggle="toggleGroup(g.name)"
        @settings="openGroupParams(g)"
        @select="(name) => onSelect(g, name)"
        @test-node="onTestNode"
        @test-group="onTestGroup(g).catch(() => {})"
      />
      </div>
    </template>

    <!-- 代理集合 -->
    <template v-else>
      <div v-if="!providerList.length" class="card">
        <EmptyState
          icon="box"
          :title="backend.isStandard ? '没有订阅' : '没有代理集合'"
          :description="backend.isStandard ? '后端配置中没有订阅（subscription）。' : '配置文件中未定义 proxy-providers。'"
        />
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section v-for="p in providerList" :key="p.name" class="card flex flex-col gap-3 p-4">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h3 class="truncate font-semibold">{{ p.name }}</h3>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span class="chip">{{ p.vehicleType }}</span>
                <span>{{ providerStats(p).count }} 个节点</span>
                <span>· 更新于 {{ formatRelativeTime(p.updatedAt) }}</span>
              </div>
              <!-- 标准 API：订阅拉取失败时保留上次的节点，并给出原因 -->
              <div v-if="p._lastError || p._status === 'stale'" class="mt-1 truncate text-xs text-amber-600 dark:text-amber-400" :title="p._lastError?.message || p._lastError || ''">
                {{ p._lastError?.message || p._lastError || '订阅未产出节点（stale）' }}
              </div>
            </div>
          </div>

          <!-- 订阅流量 -->
          <div v-if="subscription(p)" class="text-xs">
            <div class="mb-1 flex justify-between text-slate-500">
              <span>{{ subscription(p).used }} / {{ subscription(p).total }}</span>
              <span>到期 {{ subscription(p).expire }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-tile">
              <div
                class="h-full rounded-full"
                :class="subscription(p).percent > 90 ? 'bg-rose-500' : 'bg-brand-500'"
                :style="{ width: `${subscription(p).percent}%` }"
              />
            </div>
          </div>

          <div class="text-xs text-slate-500">
            可用 {{ providerStats(p).alive }} / {{ providerStats(p).count }}
            <template v-if="providerStats(p).avg">· 平均 {{ providerStats(p).avg }} ms</template>
          </div>

          <div v-if="p._canUpdate !== false || p._canHealthcheck !== false || backend.isStandard" class="mt-auto flex gap-2">
            <button
              v-if="p._canUpdate !== false"
              class="btn-outline flex-1"
              :disabled="!!busyProviders[p.name]"
              @click="onUpdateProvider(p.name).catch(() => {})"
            >
              <Icon name="refresh" class="h-4 w-4" :class="busyProviders[p.name] === 'update' && 'animate-spin'" />
              更新
            </button>
            <button v-if="p._canHealthcheck !== false" class="btn-outline flex-1" :disabled="!!busyProviders[p.name]" @click="onHealthcheck(p.name)">
              <Icon name="activity" class="h-4 w-4" :class="busyProviders[p.name] === 'check' && 'animate-pulse'" />
              健康检查
            </button>
            <!-- 标准 API：查看 / 管理该来源的节点（内联可编辑，订阅只读） -->
            <button v-if="backend.isStandard" class="btn-outline flex-1" @click="openNodes(p)">
              <Icon :name="p._kind === 'inline' && canManageNodes ? 'pencil' : 'list'" class="h-4 w-4" />
              {{ p._kind === 'inline' && canManageNodes ? '管理节点' : '节点' }}
            </button>
          </div>
        </section>
      </div>
    </template>

    <!-- 标准 API：节点管理、组参数 -->
    <template v-if="backend.isStandard">
      <NodeManager
        v-model="nodeDialog.open"
        :mode="nodeDialog.mode"
        :provider="nodeDialog.provider"
        :can-manage="canManageNodes"
        :delays="delays"
        @changed="load({ silent: true })"
      />
      <GroupParamsDialog v-model="groupDialog.open" :group="groupDialog.group" @changed="load({ silent: true })" />
    </template>
  </div>
</template>
