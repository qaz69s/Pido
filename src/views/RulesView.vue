<script setup>
/**
 * 规则页
 * Tab 1「规则」：GET /rules，按配置顺序显示，支持搜索、按目标筛选，长列表分批渲染
 * Tab 2「规则集合」：GET /providers/rules，显示条目数与更新时间，支持单个 / 全部更新
 * 手机端顶部有「分流规则 / DNS」切换条（DNS 页不占底部导航位）
 * dae / honk（标准 API）：GET /api/v1/rules，只读（配置态规则，含最后的 fallback）；没有规则集合，隐藏 Tab 2
 */
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { getRules, getRuleProviders, updateRuleProvider } from '@/api/rules'
import { describeError, errorMessage } from '@/api/http'
import { useToastStore } from '@/stores/toast'
import { useBackendStore } from '@/stores/backend'
import { useInfiniteList } from '@/composables/useInfiniteList'
import { formatRelativeTime } from '@/utils/format'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import PhoneSectionSwitch from '@/components/layout/PhoneSectionSwitch.vue'

const toast = useToastStore()
const backend = useBackendStore()

/* ---------- 数据加载 ---------- */
const rules = ref([])
const providers = ref({})
const loading = ref(true)
const loadError = ref(null)
const tab = ref('rules') // rules | providers

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const [r, p] = await Promise.all([
      getRules(),
      getRuleProviders().catch(() => ({ providers: {} })), // 未配置 rule-providers 时也可能报错
    ])
    // 记录原始序号（规则按顺序匹配，序号有参考意义）
    rules.value = (r?.rules || []).map((rule, i) => ({ ...rule, index: i + 1 }))
    providers.value = p?.providers || {}
    loadError.value = null
  } catch (e) {
    loadError.value = e
    if (silent) toast.error(`刷新失败：${errorMessage(e)}`)
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ---------- 规则筛选 ---------- */
const keyword = ref('')
const target = ref('') // 按目标（策略）筛选，空为全部

/** 所有出现过的目标，按出现次数降序 */
const targets = computed(() => {
  const count = {}
  for (const r of rules.value) count[r.proxy] = (count[r.proxy] || 0) + 1
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, n }))
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return rules.value.filter((r) => {
    if (target.value && r.proxy !== target.value) return false
    if (!kw) return true
    return `${r.type} ${r.payload} ${r.proxy}`.toLowerCase().includes(kw)
  })
})

const { visible, sentinel, hasMore, reset } = useInfiniteList(filtered, 200)
watch([keyword, target], reset)

/** RULE-SET 规则显示对应集合的条目数 */
function ruleSize(r) {
  if (r.type === 'RuleSet') return providers.value[r.payload]?.ruleCount ?? null
  return r.size > 0 ? r.size : null
}

/** 目标的颜色：直连绿、拒绝红、其它主色 */
function targetClass(name) {
  const n = (name || '').toUpperCase()
  if (n === 'DIRECT') return 'text-emerald-600 dark:text-emerald-400'
  if (n.startsWith('REJECT') || n === 'BLOCK') return 'text-rose-600 dark:text-rose-400' // BLOCK：dae 的拒绝出站
  return 'text-brand-600 dark:text-brand-400'
}

/** 规则类型显示名：后端返回驼峰（DomainSuffix），转成配置文件里的写法（DOMAIN-SUFFIX） */
const TYPE_NAMES = {
  Domain: 'DOMAIN',
  DomainSuffix: 'DOMAIN-SUFFIX',
  DomainKeyword: 'DOMAIN-KEYWORD',
  DomainRegex: 'DOMAIN-REGEX',
  DomainWildcard: 'DOMAIN-WILDCARD',
  GeoSite: 'GEOSITE',
  GeoIP: 'GEOIP',
  SrcGeoIP: 'SRC-GEOIP',
  IPASN: 'IP-ASN',
  SrcIPASN: 'SRC-IP-ASN',
  IPCIDR: 'IP-CIDR',
  IPCIDR6: 'IP-CIDR6',
  SrcIPCIDR: 'SRC-IP-CIDR',
  IPSuffix: 'IP-SUFFIX',
  SrcIPSuffix: 'SRC-IP-SUFFIX',
  SrcPort: 'SRC-PORT',
  DstPort: 'DST-PORT',
  InPort: 'IN-PORT',
  InUser: 'IN-USER',
  InName: 'IN-NAME',
  InType: 'IN-TYPE',
  ProcessName: 'PROCESS-NAME',
  ProcessPath: 'PROCESS-PATH',
  ProcessNameRegex: 'PROCESS-NAME-REGEX',
  ProcessPathRegex: 'PROCESS-PATH-REGEX',
  Network: 'NETWORK',
  Uid: 'UID',
  DSCP: 'DSCP',
  RuleSet: 'RULE-SET',
  SubRules: 'SUB-RULE',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  Match: 'MATCH',
}
const typeName = (t) => TYPE_NAMES[t] || t

/* ---------- 规则集合 ---------- */
const providerList = computed(() => Object.values(providers.value))
const busy = reactive({}) // { 集合名: true }

async function onUpdateProvider(name, { quiet = false } = {}) {
  busy[name] = true
  try {
    await updateRuleProvider(name)
    if (!quiet) toast.success(`${name} 已更新`)
  } catch (e) {
    if (!quiet) toast.error(`${name} 更新失败：${errorMessage(e)}`)
    throw e
  } finally {
    delete busy[name]
  }
  if (!quiet) load({ silent: true })
}

const updatingAll = ref(false)
async function onUpdateAll() {
  updatingAll.value = true
  const results = await Promise.allSettled(providerList.value.map((p) => onUpdateProvider(p.name, { quiet: true })))
  updatingAll.value = false
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) toast.warning(`更新完成，${failed} 个失败`)
  else toast.success('全部规则集合已更新')
  load({ silent: true })
}

const BEHAVIOR_LABEL = { Domain: '域名', IPCIDR: 'IP 段', Classical: '经典' }
const FORMAT_LABEL = { YamlRule: 'YAML', TextRule: 'Text', MrsRule: 'MRS' }

/** 点击规则集合卡片上的“查看规则” → 切回规则页并按集合名搜索 */
function showRulesOf(name) {
  tab.value = 'rules'
  target.value = ''
  keyword.value = name
}

const loadErrorInfo = computed(() => (loadError.value ? describeError(loadError.value) : null))
</script>

<template>
  <div class="space-y-3">
    <!-- 手机端：规则 / DNS 切换（DNS 不占底部导航位） -->
    <PhoneSectionSwitch />

    <!-- 工具栏：固定一行不换行（系统字体放大时标签先截断）；手机端搜索框单独一行 -->
    <div class="flex flex-nowrap items-center gap-2">
      <div class="tb-tabs flex min-w-0 shrink-0 overflow-hidden rounded-lg bg-slate-200/70 p-0.5 text-sm dark:bg-slate-800">
        <button
          v-for="t in backend.isStandard
            ? [{ key: 'rules', label: '规则', count: rules.length }]
            : [
                { key: 'rules', label: '规则', count: rules.length },
                { key: 'providers', label: '规则集合', count: providerList.length },
              ]"
          :key="t.key"
          class="min-w-0 shrink truncate whitespace-nowrap rounded-md transition"
          :class="tab === t.key ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'"
          @click="tab = t.key"
        >
          {{ t.label }} <span class="tab-count w4 text-xs text-slate-400">{{ t.count }}</span>
        </button>
      </div>

      <template v-if="tab === 'rules'">
        <!-- 桌面端：搜索框内联 -->
        <div class="relative hidden flex-1 sm:block">
          <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input v-model="keyword" type="search" class="input py-1.5 pl-8" placeholder="搜索规则内容、类型或目标" />
        </div>
        <select v-model="target" class="input ml-auto w-auto min-w-0 max-w-[45%] shrink py-1.5 sm:ml-0" title="按目标筛选">
          <option value="">全部目标</option>
          <option v-for="t in targets" :key="t.name" :value="t.name">{{ t.name }}（{{ t.n }}）</option>
        </select>
        <div class="tb flex shrink-0 items-center">
          <button class="btn-icon" title="刷新列表" @click="load({ silent: true })">
            <Icon name="refresh" class="h-[18px] w-[18px]" />
          </button>
        </div>
      </template>
      <!-- 规则集合：只保留一个「全部更新」，更新完成后会自动刷新列表 -->
      <div v-else class="tb ml-auto flex shrink-0 items-center">
        <button class="btn-primary" title="全部更新（重新下载所有规则集合）" :disabled="updatingAll || !providerList.length" @click="onUpdateAll">
          <Icon name="download" class="h-4 w-4" :class="updatingAll && 'animate-bounce'" />
          <span class="whitespace-nowrap">{{ updatingAll ? '更新中' : '全部更新' }}</span>
        </button>
      </div>
    </div>

    <!-- 手机端：搜索框单独一行 -->
    <div v-if="tab === 'rules'" class="relative sm:hidden">
      <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input v-model="keyword" type="search" class="input py-1.5 pl-8" placeholder="搜索规则内容、类型或目标" />
    </div>

    <div v-if="loading" class="card divide-y divide-slate-100 dark:divide-slate-800">
      <div v-for="i in 8" :key="i" class="skeleton h-12" />
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadErrorInfo" class="card">
      <EmptyState icon="alert" :title="loadErrorInfo.title" :tips="loadErrorInfo.tips">
        <button class="btn-primary" @click="load()">重试</button>
        <RouterLink to="/setup" class="btn-outline">修改设置</RouterLink>
      </EmptyState>
    </div>

    <!-- 规则列表 -->
    <template v-else-if="tab === 'rules'">
      <div v-if="!filtered.length" class="card">
        <EmptyState
          :icon="keyword || target ? 'search' : 'list'"
          :title="keyword || target ? '没有匹配的规则' : '没有规则'"
        />
      </div>
      <div v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
        <div
          v-for="r in visible"
          :key="r.index"
          class="flex items-center gap-3 px-3 py-2.5 text-sm sm:px-4"
        >
          <span class="w-8 shrink-0 text-right text-xs tabular-nums text-slate-400">{{ r.index }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate font-mono text-[13px]" :title="r.payload">{{ r.payload || '（全部流量）' }}</span>
              <span v-if="ruleSize(r) != null" class="shrink-0 text-xs text-slate-400">{{ ruleSize(r) }} 条</span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 sm:hidden">
              <span class="chip">{{ typeName(r.type) }}</span>
              <span class="truncate text-xs font-medium" :class="targetClass(r.proxy)">→ {{ r.proxy }}</span>
            </div>
          </div>
          <span class="chip hidden shrink-0 sm:inline-flex">{{ typeName(r.type) }}</span>
          <span
            class="hidden w-36 shrink-0 truncate text-right font-medium sm:block"
            :class="targetClass(r.proxy)"
            :title="r.proxy"
          >
            {{ r.proxy }}
          </span>
        </div>
        <div v-if="hasMore" ref="sentinel" class="py-3 text-center text-xs text-slate-400">加载中…</div>
      </div>
      <p v-if="filtered.length" class="text-center text-xs text-slate-400">
        共 {{ filtered.length }} 条{{ keyword || target ? '匹配' : '' }}规则 · 按从上到下的顺序匹配
      </p>
    </template>

    <!-- 规则集合 -->
    <template v-else>
      <div v-if="!providerList.length" class="card">
        <EmptyState icon="box" title="没有规则集合" description="配置文件中未定义 rule-providers。" />
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section v-for="p in providerList" :key="p.name" class="card flex flex-col gap-3 p-4">
          <div class="min-w-0">
            <h3 class="truncate font-semibold" :title="p.name">{{ p.name }}</h3>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span class="chip">{{ BEHAVIOR_LABEL[p.behavior] || p.behavior }}</span>
              <span class="chip">{{ FORMAT_LABEL[p.format] || p.format }}</span>
              <span class="chip">{{ p.vehicleType }}</span>
            </div>
          </div>
          <div class="flex items-end justify-between text-sm">
            <div>
              <div class="text-2xl font-semibold tabular-nums">{{ p.ruleCount?.toLocaleString() ?? '--' }}</div>
              <div class="text-xs text-slate-500">条规则</div>
            </div>
            <div class="text-right text-xs text-slate-500">更新于<br />{{ formatRelativeTime(p.updatedAt) }}</div>
          </div>
          <div class="mt-auto flex gap-2">
            <button class="btn-outline flex-1" @click="showRulesOf(p.name)">
              <Icon name="list" class="h-4 w-4" />
              查看引用
            </button>
            <button class="btn-outline flex-1" :disabled="!!busy[p.name]" @click="onUpdateProvider(p.name).catch(() => {})">
              <Icon name="refresh" class="h-4 w-4" :class="busy[p.name] && 'animate-spin'" />
              更新
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
