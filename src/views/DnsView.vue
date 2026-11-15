<script setup>
/**
 * DNS 页
 * dae / honk（标准 API）四个标签：
 *   查询日志  GET /api/v1/dns/log（按域名子串 / 记录类型 / 来源 IP 过滤，最新在前，cursor 翻页；410 时从头开始）
 *   缓存      GET /api/v1/dns/cache（本地搜索已加载的条目），删除单条、按域名删除、清空全部
 *   查询      POST /api/v1/dns/query（绕过缓存、指定上游，显示耗时；每分钟 60 次）
 *   规则      GET /api/v1/dns/rules（只读，request / response 两张表）
 *   DNS controller 未运行时接口返回 503 → 显示“DNS 模块未运行”
 * mihomo：只有查询工具（GET /dns/query）与清空 DNS / FakeIP 缓存（POST /cache/dns/flush、/cache/fakeip/flush）
 * 手机上 DNS 没有独立的底部导航项，从「规则」页顶部的切换条进入（见 PhoneSectionSwitch.vue）
 */
import { computed, reactive, ref, watch, onMounted } from 'vue'
import {
  getDnsLog,
  getDnsCache,
  deleteDnsEntry,
  deleteDnsByName,
  flushStandardDnsCache,
  getDnsRules,
} from '@/api/dns'
import { flushDnsCache, flushFakeIpCache } from '@/api/configs'
import { describeError, errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import SettingRow from '@/components/common/SettingRow.vue'
import DnsQueryTool from '@/components/dns/DnsQueryTool.vue'
import PhoneSectionSwitch from '@/components/layout/PhoneSectionSwitch.vue'

const backend = useBackendStore()
const toast = useToastStore()
const confirm = useConfirmStore()

const tab = ref('log') // log | cache | query | rules
const TABS = [
  { key: 'log', label: '查询日志' },
  { key: 'cache', label: '缓存' },
  { key: 'query', label: '查询' },
  { key: 'rules', label: '规则' },
]

/** 503 / 404 等错误 → 空状态文案 */
function errorState(e) {
  if (!e) return null
  if (e.status === 503) {
    return {
      title: 'DNS 模块未运行',
      description: `${backend.engine} 的 DNS 控制器当前没有工作，DNS 日志、缓存与查询暂不可用。`,
      tips: [`确认配置中有 dns 段，并且 ${backend.engine} 已完成启动`, '修改 dns 段后在「配置」页保存并重载'],
    }
  }
  if (e.status === 404) return { title: `当前 ${backend.engine} 不支持此功能`, description: '需要 dae ≥ 2.1.2 的原生 API。', tips: [] }
  return describeError(e)
}

const time = (t) => {
  const d = new Date(t)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('zh-CN', { hour12: false }) : '--'
}
/** 去掉末尾的点：example.com. → example.com */
const host = (n) => String(n || '').replace(/\.$/, '')
/** 答案摘要：前两条 data，其余用 +n */
function answersBrief(list) {
  const a = (list || []).map((x) => x.data)
  if (!a.length) return ''
  return a.slice(0, 2).join(', ') + (a.length > 2 ? ` +${a.length - 2}` : '')
}
const STATUS_CLASS = (s) =>
  s === 'NOERROR'
    ? 'text-emerald-600 dark:text-emerald-400'
    : s === 'NXDOMAIN' || s === 'NODATA'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-rose-600 dark:text-rose-400'

const recordTypes = computed(() => backend.caps?.resources?.dns_query?.record_types || ['A', 'AAAA', 'HTTPS'])
const typeFilterOptions = computed(() => [...new Set(['A', 'AAAA', 'CNAME', 'HTTPS', ...recordTypes.value])])

/* ================= 查询日志 ================= */
const log = reactive({ records: [], cursor: null, total: 0, loading: false, more: false, error: null, loaded: false })
const logFilter = reactive({ name: '', type: '', src: '' })

async function loadLog({ append = false } = {}) {
  if (append) log.more = true
  else log.loading = true
  try {
    const r = await getDnsLog({
      name: logFilter.name.trim() || undefined,
      type: logFilter.type || undefined,
      src: logFilter.src.trim() || undefined,
      limit: 100,
      cursor: append ? log.cursor : undefined,
    })
    log.records = append ? [...log.records, ...(r?.records || [])] : r?.records || []
    log.cursor = r?.next_cursor || null
    log.total = r?.total ?? log.records.length
    log.error = null
  } catch (e) {
    if (e.status === 410 && append) {
      // 游标指向的记录已被挤出环形缓冲：从最新一页重新开始
      toast.info('日志已滚动，已从最新记录重新加载')
      return loadLog()
    }
    if (e.status === 400 && logFilter.src) toast.warning('来源需要填写 IP 地址（不带端口）')
    else log.error = e
  } finally {
    log.loading = false
    log.more = false
    log.loaded = true
  }
}
let logTimer = 0
watch(logFilter, () => {
  clearTimeout(logTimer)
  logTimer = setTimeout(() => loadLog(), 400)
})

/* ================= 缓存 ================= */
const cache = reactive({ entries: [], cursor: null, total: 0, usage: null, loading: false, more: false, error: null, loaded: false })
const cacheSearch = ref('')
const busyEntry = ref('')

async function loadCache({ append = false } = {}) {
  if (append) cache.more = true
  else cache.loading = true
  try {
    const r = await getDnsCache({ limit: 200, cursor: append ? cache.cursor : undefined })
    cache.entries = append ? [...cache.entries, ...(r?.entries || [])] : r?.entries || []
    cache.cursor = r?.next_cursor || null
    cache.total = r?.total ?? cache.entries.length
    cache.usage = r?.usage || null
    cache.error = null
  } catch (e) {
    if (e.status === 410 && append) return loadCache()
    cache.error = e
  } finally {
    cache.loading = false
    cache.more = false
    cache.loaded = true
  }
}

const cacheShown = computed(() => {
  const k = cacheSearch.value.trim().toLowerCase().replace(/\.$/, '')
  if (!k) return cache.entries
  return cache.entries.filter((e) => e.domain.toLowerCase().includes(k) || (e.answers || []).some((a) => String(a.data).includes(k)))
})
/** 搜索框内容是一个完整域名、且已加载的条目里有它 → 提供“按域名删除” */
const exactDomain = computed(() => {
  const k = cacheSearch.value.trim().toLowerCase().replace(/\.$/, '')
  return k && cache.entries.some((e) => host(e.domain).toLowerCase() === k) ? k : ''
})

function expiresText(e) {
  const left = (Date.parse(e.expires_at) - Date.now()) / 1000
  if (!Number.isFinite(left)) return ''
  if (left <= 0) return e.stale_until ? '已过期（可陈旧使用）' : '已过期'
  if (left < 60) return `剩 ${Math.round(left)} 秒`
  if (left < 3600) return `剩 ${Math.round(left / 60)} 分钟`
  return `剩 ${Math.round(left / 3600)} 小时`
}

async function removeEntry(e) {
  busyEntry.value = e.entry_id
  try {
    await deleteDnsEntry(e.entry_id)
    cache.entries = cache.entries.filter((x) => x.entry_id !== e.entry_id)
    cache.total = Math.max(0, cache.total - 1)
  } catch (err) {
    toast.error(`删除失败：${errorMessage(err)}`)
  } finally {
    busyEntry.value = ''
  }
}

async function removeByName() {
  const name = exactDomain.value
  if (!name) return
  try {
    const r = await deleteDnsByName(name)
    toast.success(`已删除 ${name} 的 ${r?.deleted ?? 0} 条缓存`)
    loadCache()
  } catch (err) {
    toast.error(`删除失败：${errorMessage(err)}`)
  }
}

const flushing = ref(false)
async function flushAll() {
  const ok = await confirm.ask({ title: '清空全部 DNS 缓存？', message: '之后的解析都要重新请求上游，短时间内会变慢。', danger: true, confirmText: '清空' })
  if (!ok) return
  flushing.value = true
  try {
    const r = await flushStandardDnsCache()
    toast.success(`已清空 ${r?.deleted ?? 0} 条缓存`)
    loadCache()
  } catch (err) {
    toast.error(`清空失败：${errorMessage(err)}`)
  } finally {
    flushing.value = false
  }
}

/* ================= 规则 ================= */
const rules = reactive({ data: null, loading: false, error: null, loaded: false })
async function loadRules() {
  rules.loading = true
  try {
    rules.data = await getDnsRules()
    rules.error = null
  } catch (e) {
    rules.error = e
  } finally {
    rules.loading = false
    rules.loaded = true
  }
}
/** 查询工具的上游下拉：DNS 规则里出现过的上游名称 */
const upstreams = computed(() => {
  const d = rules.data
  if (!d) return []
  return [...new Set([...(d.request || []), ...(d.response || [])].map((r) => r.upstream).filter(Boolean))]
})
const ACTION_LABEL = { upstream: '上游', reject: '拒绝', asis: '原样', accept: '接受', requery: '重查', drop: '丢弃' }

/* ================= 切换标签时按需加载 ================= */
function ensure(t) {
  if (!backend.isStandard) return
  if (t === 'log' && !log.loaded) loadLog()
  if (t === 'cache' && !cache.loaded) loadCache()
  if ((t === 'rules' || t === 'query') && !rules.loaded) loadRules()
}
watch(tab, ensure)
onMounted(() => {
  ensure(tab.value)
  if (backend.isStandard && !rules.loaded) loadRules() // 查询工具需要上游列表
})
function refresh() {
  if (tab.value === 'log') loadLog()
  else if (tab.value === 'cache') loadCache()
  else if (tab.value === 'rules') loadRules()
}

/* ================= mihomo：清缓存 ================= */
const mihomoBusy = reactive({})
const MIHOMO_ACTIONS = [
  { key: 'dns', label: '清空 DNS 缓存', desc: '解析结果异常或切换了上游后使用（较新的内核支持）', run: flushDnsCache, ok: 'DNS 缓存已清空' },
  { key: 'fakeip', label: '清空 FakeIP 缓存', desc: '域名映射异常时使用', run: flushFakeIpCache, ok: 'FakeIP 缓存已清空' },
]
async function runMihomo(a) {
  mihomoBusy[a.key] = true
  try {
    await a.run()
    toast.success(a.ok)
  } catch (e) {
    if (e.status === 404) toast.warning(`当前内核不支持「${a.label}」`)
    else toast.error(`${a.label}失败：${errorMessage(e)}`)
  } finally {
    delete mihomoBusy[a.key]
  }
}
</script>

<template>
  <div class="space-y-3">
    <PhoneSectionSwitch />

    <!-- ================= mihomo ================= -->
    <div v-if="!backend.isStandard" class="grid items-start gap-3 lg:grid-cols-2">
      <DnsQueryTool />
      <section class="card divide-y divide-slate-100 dark:divide-slate-800">
        <h2 class="px-4 pb-2 pt-4 font-semibold">缓存</h2>
        <SettingRow v-for="a in MIHOMO_ACTIONS" :key="a.key" :title="a.label" :description="a.desc">
          <button class="btn-outline py-1 text-xs" :disabled="!!mihomoBusy[a.key]" @click="runMihomo(a)">
            <Icon name="trash" class="h-3.5 w-3.5" :class="mihomoBusy[a.key] && 'animate-pulse'" />
            {{ mihomoBusy[a.key] ? '执行中…' : '执行' }}
          </button>
        </SettingRow>
      </section>
    </div>

    <!-- ================= 标准 API ================= -->
    <template v-else>
      <!-- 标签 + 刷新：与代理页工具栏一致，固定像素，字体放大时保持一行 -->
      <div class="flex items-center gap-2">
        <div class="tb-tabs no-scrollbar flex min-w-0 shrink overflow-x-auto rounded-lg bg-slate-200/70 p-0.5 text-sm dark:bg-slate-800">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="whitespace-nowrap rounded-md transition"
            :class="tab === t.key ? 'bg-white font-medium shadow-sm dark:bg-slate-900' : 'text-slate-500'"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="tb ml-auto flex shrink-0 items-center">
          <button v-if="tab !== 'query'" class="btn-icon" title="刷新" @click="refresh">
            <Icon name="refresh" class="h-[18px] w-[18px]" :class="(log.loading || cache.loading || rules.loading) && 'animate-spin'" />
          </button>
        </div>
      </div>

      <!-- ---------- 查询日志 ---------- -->
      <template v-if="tab === 'log'">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
          <div class="relative col-span-2 sm:col-span-1">
            <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input v-model="logFilter.name" class="input pl-8" placeholder="域名包含…" autocapitalize="off" spellcheck="false" />
          </div>
          <select v-model="logFilter.type" class="input" aria-label="记录类型">
            <option value="">全部类型</option>
            <option v-for="t in typeFilterOptions" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="logFilter.src" class="input font-mono" placeholder="来源 IP" inputmode="decimal" aria-label="来源 IP" />
        </div>

        <div v-if="log.loading && !log.records.length" class="space-y-2">
          <div v-for="i in 6" :key="i" class="card skeleton h-14" />
        </div>
        <div v-else-if="log.error" class="card">
          <EmptyState icon="alert" v-bind="errorState(log.error)">
            <button class="btn-primary" @click="loadLog()">重试</button>
          </EmptyState>
        </div>
        <div v-else-if="!log.records.length" class="card">
          <EmptyState icon="compass" title="没有查询记录" :description="logFilter.name || logFilter.type || logFilter.src ? '没有符合条件的记录，换个条件试试。' : '客户端发起解析后会出现在这里（诊断查询不记录）。'" />
        </div>
        <section v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
          <div v-for="r in log.records" :key="r.id" class="px-4 py-2.5">
            <!-- 第一行只放域名与耗时：手机上域名完整显示，过长时换行而不截断 -->
            <div class="flex items-start gap-2 text-sm">
              <span class="min-w-0 flex-1 break-all font-mono">{{ host(r.question?.name) }}</span>
              <span class="shrink-0 text-xs tabular-nums text-slate-500">{{ r.elapsed_ms }} ms</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              <span class="tabular-nums text-slate-400">{{ time(r.observed_at) }}</span>
              <span class="chip font-mono">{{ r.question?.type }}</span>
              <!-- 状态放第二行：手机上不挤占域名 -->
              <span v-if="r.status !== 'NOERROR'" class="font-medium" :class="STATUS_CLASS(r.status)">{{ r.status }}</span>
              <span v-if="r.src" class="font-mono">{{ r.src }}</span>
              <span v-if="r.cached" class="text-sky-600 dark:text-sky-400">命中缓存</span>
              <span v-else-if="r.upstream">上游 <span class="font-mono">{{ r.upstream }}</span></span>
              <span v-if="answersBrief(r.answers)" class="min-w-0 truncate font-mono text-slate-400" :title="answersBrief(r.answers)">→ {{ answersBrief(r.answers) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between px-4 py-2 text-xs text-slate-500">
            <span>已显示 {{ log.records.length }} 条<template v-if="log.total"> · 缓冲区共 {{ log.total }} 条</template></span>
            <button v-if="log.cursor" class="btn-ghost py-1 text-xs" :disabled="log.more" @click="loadLog({ append: true })">
              {{ log.more ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </section>
      </template>

      <!-- ---------- 缓存 ---------- -->
      <template v-else-if="tab === 'cache'">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-0 flex-1 basis-48">
            <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input v-model="cacheSearch" class="input pl-8" placeholder="搜索域名或 IP" autocapitalize="off" spellcheck="false" />
          </div>
          <button v-if="exactDomain" class="btn-outline" @click="removeByName">
            <Icon name="trash" class="h-4 w-4" />
            删除该域名
          </button>
          <button class="btn-danger" :disabled="flushing || cache.loading" @click="flushAll">
            <Icon name="trash" class="h-4 w-4" :class="flushing && 'animate-pulse'" />
            清空全部
          </button>
        </div>

        <div v-if="cache.loading && !cache.entries.length" class="space-y-2">
          <div v-for="i in 6" :key="i" class="card skeleton h-14" />
        </div>
        <div v-else-if="cache.error" class="card">
          <EmptyState icon="alert" v-bind="errorState(cache.error)">
            <button class="btn-primary" @click="loadCache()">重试</button>
          </EmptyState>
        </div>
        <div v-else-if="!cacheShown.length" class="card">
          <EmptyState icon="database" :title="cacheSearch ? '没有匹配的缓存' : '缓存为空'" />
        </div>
        <section v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
          <div v-for="e in cacheShown" :key="e.entry_id" class="flex items-center gap-2 px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-sm">
                <span class="chip shrink-0 font-mono">{{ e.type }}</span>
                <span class="min-w-0 truncate font-mono" :title="host(e.domain)">{{ host(e.domain) }}</span>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span v-if="e.status !== 'NOERROR'" class="font-medium" :class="STATUS_CLASS(e.status)">{{ e.status }}</span>
                <span v-if="answersBrief(e.answers)" class="min-w-0 truncate font-mono" :title="answersBrief(e.answers)">{{ answersBrief(e.answers) }}</span>
                <span>{{ expiresText(e) }}</span>
              </div>
            </div>
            <button class="btn-icon h-8 w-8 shrink-0 hover:!text-rose-600" title="删除这条缓存" :disabled="busyEntry === e.entry_id" @click="removeEntry(e)">
              <Icon name="trash" class="h-4 w-4" :class="busyEntry === e.entry_id && 'animate-pulse'" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500">
            <span>
              已加载 {{ cache.entries.length }} / {{ cache.total }} 条
              <template v-if="cache.usage?.entry_capacity"> · 容量 {{ cache.usage.entries }} / {{ cache.usage.entry_capacity }}</template>
            </span>
            <button v-if="cache.cursor" class="btn-ghost py-1 text-xs" :disabled="cache.more" @click="loadCache({ append: true })">
              {{ cache.more ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </section>
      </template>

      <!-- ---------- 查询 ---------- -->
      <DnsQueryTool v-else-if="tab === 'query'" :upstreams="upstreams" :record-types="recordTypes" @queried="cache.loaded = false" />

      <!-- ---------- 规则（只读） ---------- -->
      <template v-else>
        <div v-if="rules.loading && !rules.data" class="space-y-2">
          <div v-for="i in 4" :key="i" class="card skeleton h-12" />
        </div>
        <div v-else-if="rules.error" class="card">
          <EmptyState icon="alert" v-bind="errorState(rules.error)">
            <button class="btn-primary" @click="loadRules()">重试</button>
          </EmptyState>
        </div>
        <template v-else-if="rules.data">
          <p class="flex items-start gap-1.5 text-xs text-slate-500">
            <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
            只读：按顺序匹配，最后一条为 fallback。修改请在「配置」页编辑 dns.dae 后保存并重载。
          </p>
          <div class="grid items-start gap-3 lg:grid-cols-2">
            <section v-for="part in [{ key: 'request', title: '请求规则', desc: '决定用哪个上游解析' }, { key: 'response', title: '响应规则', desc: '决定是否接受上游的答案' }]" :key="part.key" class="card">
              <div class="px-4 pb-2 pt-4">
                <h2 class="font-semibold">{{ part.title }}</h2>
                <p class="text-xs text-slate-500">{{ part.desc }}</p>
              </div>
              <ol class="divide-y divide-slate-100 dark:divide-slate-800">
                <li v-for="r in rules.data[part.key] || []" :key="r.rule_id" class="flex items-start gap-3 px-4 py-2 text-sm">
                  <span class="w-6 shrink-0 text-right text-xs tabular-nums text-slate-400">{{ r.kind === 'fallback' ? '' : r.index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <div class="break-all font-mono text-[13px]" :class="r.kind === 'fallback' && 'text-slate-500'">{{ r.expression }}</div>
                    <div class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
                      <span>{{ ACTION_LABEL[r.action] || r.action }}<template v-if="r.upstream"> · {{ r.upstream }}</template></span>
                      <span v-if="r.source?.file" class="font-mono">{{ r.source.file }}<template v-if="r.source.line">:{{ r.source.line }}</template></span>
                    </div>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
