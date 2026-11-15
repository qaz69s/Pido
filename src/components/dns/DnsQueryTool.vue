<script setup>
/**
 * DNS 查询工具（mihomo 与 dae / honk 共用）
 * - mihomo：GET /dns/query?name=&type=，每种记录类型一次请求
 * - 标准 API：POST /api/v1/dns/query，可强制上游、绕过缓存；结果带是否命中缓存、上游、耗时
 *   限流：每个调用方每分钟 60 次，超出返回 429（附 Retry-After）→ 友好提示
 */
import { computed, reactive, ref } from 'vue'
import { queryDns } from '@/api/dns'
import { errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import Icon from '@/components/common/Icon.vue'
import Switch from '@/components/common/Switch.vue'

const props = defineProps({
  /** 可选的上游名称（来自 DNS 规则）；空数组时不显示上游选择 */
  upstreams: { type: Array, default: () => [] },
  /** 后端支持的记录类型（capabilities.dns_query.record_types） */
  recordTypes: { type: Array, default: () => ['A', 'AAAA'] },
})
const emit = defineEmits(['queried'])
const backend = useBackendStore()

const form = reactive({ domain: '', types: ['A', 'AAAA'], upstream: '', bypass: false })
const running = ref(false)
const result = ref(null) // { domain, results, elapsed }
const error = ref('')

const typeOptions = computed(() => {
  const base = backend.isStandard ? props.recordTypes : ['A', 'AAAA', 'CNAME', 'HTTPS', 'TXT', 'MX']
  return [...new Set(['A', 'AAAA', ...base])]
})

function toggleType(t) {
  form.types = form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t]
}

/** 去掉协议 / 路径，用户粘贴网址时也能查 */
function cleanDomain(s) {
  return s
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
}

async function run() {
  const domain = cleanDomain(form.domain)
  error.value = ''
  if (!domain) {
    error.value = '请输入域名'
    return
  }
  if (!form.types.length) {
    error.value = '至少选择一种记录类型'
    return
  }
  running.value = true
  try {
    const r = await queryDns({ domain, types: form.types, upstream: form.upstream || undefined, bypass: form.bypass })
    result.value = { domain, ...r }
    emit('queried')
  } catch (e) {
    result.value = null
    if (e.status === 429) error.value = `查询太频繁：每分钟最多 60 次，请 ${e.retryAfter || 60} 秒后再试`
    else if (e.status === 503) error.value = 'DNS 模块未运行，暂时无法查询'
    else if (e.status === 422) error.value = `参数无效：${e.detail?.error?.message || errorMessage(e)}`
    else if (e.status === 404 && backend.isStandard) error.value = `当前 ${backend.engine} 不支持 DNS 查询`
    else if (!backend.isStandard && e.status >= 500) error.value = `查询失败：${errorMessage(e)}（mihomo 需要启用 dns 段）`
    else error.value = `查询失败：${errorMessage(e)}`
  } finally {
    running.value = false
  }
}

const STATUS_CLASS = (s) =>
  s === 'NOERROR'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
    : s === 'NXDOMAIN' || s === 'NODATA'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
</script>

<template>
  <section class="card p-4">
    <h2 class="mb-3 font-semibold">查询</h2>
    <form class="space-y-3" @submit.prevent="run">
      <div class="flex gap-2">
        <input
          v-model="form.domain"
          class="input min-w-0 flex-1 font-mono"
          placeholder="example.com"
          inputmode="url"
          autocapitalize="off"
          spellcheck="false"
          aria-label="域名"
        />
        <button class="btn-primary shrink-0" type="submit" :disabled="running">
          <Icon name="search" class="h-4 w-4" :class="running && 'animate-pulse'" />
          {{ running ? '查询中…' : '查询' }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="记录类型">
          <button
            v-for="t in typeOptions"
            :key="t"
            type="button"
            class="rounded-md border px-2 py-0.5 font-mono text-xs transition"
            :class="form.types.includes(t) ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'border-slate-300 text-slate-500 dark:border-slate-700'"
            @click="toggleType(t)"
          >
            {{ t }}
          </button>
        </div>
        <template v-if="backend.isStandard">
          <label v-if="upstreams.length" class="flex items-center gap-2 text-sm">
            <span class="whitespace-nowrap text-slate-500">上游</span>
            <select v-model="form.upstream" class="input w-auto py-1">
              <option value="">按 DNS 规则</option>
              <option v-for="u in upstreams" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm">
            <Switch v-model="form.bypass" />
            <span class="whitespace-nowrap text-slate-500">绕过缓存</span>
          </label>
        </template>
      </div>
    </form>

    <p v-if="error" class="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
      <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0" />
      {{ error }}
    </p>

    <div v-if="result" class="mt-4 space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span class="font-mono font-medium">{{ result.domain }}</span>
        <span class="text-xs text-slate-500">总耗时 {{ result.elapsed }} ms</span>
      </div>
      <div v-for="r in result.results" :key="r.type" class="rounded-xl bg-tile p-3">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="chip !bg-transparent font-mono !text-slate-700 ring-1 ring-slate-300 dark:!text-slate-200 dark:ring-slate-600">{{ r.type }}</span>
          <span class="rounded-md px-1.5 py-0.5 font-medium" :class="STATUS_CLASS(r.status)">{{ r.status }}</span>
          <span v-if="r.cached === true" class="chip !bg-sky-100 !text-sky-700 dark:!bg-sky-900/50 dark:!text-sky-300">命中缓存</span>
          <span v-if="r.upstream" class="truncate text-slate-500">上游 <span class="font-mono">{{ r.upstream }}</span></span>
          <span v-if="r.route?.rule" class="truncate text-slate-500" :title="r.route.rule">规则 <span class="font-mono">{{ r.route.rule }}</span></span>
          <span class="ml-auto shrink-0 tabular-nums text-slate-500">{{ r.elapsed_ms ?? '--' }} ms</span>
        </div>
        <ul v-if="r.answers?.length" class="mt-2 space-y-1 text-sm">
          <li v-for="(a, i) in r.answers" :key="i" class="flex items-baseline gap-2">
            <!-- 与查询类型相同时不重复显示（CNAME 链等不同类型才标出） -->
            <span v-if="a.type !== r.type" class="shrink-0 font-mono text-xs text-slate-400">{{ a.type }}</span>
            <span class="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{{ a.data }}</span>
            <span class="shrink-0 text-xs tabular-nums text-slate-400">TTL {{ a.ttl }}</span>
          </li>
        </ul>
        <p v-else class="mt-2 text-sm text-slate-500">没有记录</p>
      </div>
    </div>
  </section>
</template>
