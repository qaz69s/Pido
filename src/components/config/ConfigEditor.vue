<script setup>
/**
 * 配置文件编辑（dae / honk，标准 API）
 * - 文件列表：GET /api/v1/config 的 sources[]（dae 受管布局下为 config.dae + config.d/*.dae；api.dae 由后端隐藏）
 * - 流程：编辑 → 校验（POST /config/validate，诊断按行标红，点击跳转）→ 保存并重载
 *   （PUT /config/sources/{id}，If-Match 为读取时的 content_sha256，202 后轮询 reload 操作）
 * - 412：文件已被他处修改 → 提示，可载入最新内容或以最新版本为基准继续保存
 * - 422：后端完整校验不通过 → 显示诊断，磁盘不会变动
 * - 只读：config_write 未开启 / 目录不是受管布局 / 入口文件 / 含监听 secret → 只读模式 + 原因 + 开启方法
 * 各文件的未保存修改保存在内存里，切换文件不会丢失
 */
import { computed, reactive, ref, onMounted, nextTick } from 'vue'
import {
  getWriteCaps,
  getEffectiveConfig,
  validateConfig,
  replaceConfigSource,
  diagnosticsOf,
  denyReasonOf,
  sha256Hex,
} from '@/api/standard/manage'
import { describeError, errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { formatBytes, formatRelativeTime } from '@/utils/format'
import CodeEditor from './CodeEditor.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'

const emit = defineEmits(['reloaded'])
const backend = useBackendStore()
const toast = useToastStore()
const confirm = useConfirmStore()

/* ---------- 加载 ---------- */
const caps = ref(null)
const config = ref(null) // GET /config
const loading = ref(true)
const loadError = ref(null)
const selectedId = ref('')
/** { 源 id: 编辑中的文本 } */
const drafts = reactive({})
/** { 源 id: true } 读到的内容与 content_sha256 不符（被脱敏），不能作为替换内容保存 */
const redacted = reactive({})
/** 写入被拒时后端给出的原因（覆盖能力里的原因） */
const deniedReason = ref('')

async function load({ keepSelection = true, silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const [c, cfg] = await Promise.all([getWriteCaps({ force: true }).catch(() => null), getEffectiveConfig()])
    caps.value = c
    config.value = cfg
    loadError.value = null
    deniedReason.value = ''
    const list = cfg?.sources || []
    if (!keepSelection || !list.some((s) => s.id === selectedId.value)) {
      // 默认打开第一个可写的模块（通常是 config.d/dns.dae 之类），否则打开入口文件
      selectedId.value = (list.find((s) => s.writable) || list[0])?.id || ''
    }
    // 校验内容是否完整（未被脱敏）
    for (const s of list) {
      const h = await sha256Hex(s.content)
      redacted[s.id] = h ? h !== s.content_sha256 : !!cfg.secrets_redacted && /<redacted>/.test(s.content)
    }
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
}
onMounted(() => load())

const sources = computed(() => config.value?.sources || [])
const current = computed(() => sources.value.find((s) => s.id === selectedId.value) || null)
const text = computed({
  get: () => (current.value ? drafts[current.value.id] ?? current.value.content : ''),
  set: (v) => {
    if (current.value) drafts[current.value.id] = v
  },
})
const isDirty = (s) => drafts[s.id] !== undefined && drafts[s.id] !== s.content
const dirty = computed(() => !!current.value && isDirty(current.value))

/** 显示用的短名：config.d/dns.dae → dns.dae */
const shortName = (p) => p.split('/').pop()

/* ---------- 只读原因 ---------- */
const REASONS = {
  writes_disabled: { title: '未开启配置写入', desc: '后端的 api 段没有开启 config_write，配置只能查看。', howto: true },
  layout_unmanaged: { title: '配置目录不是受管布局', desc: '配置没有按规范拆分，后端拒绝通过 API 写入任何文件。', howto: true },
  entry_source: { title: '入口文件只读', desc: 'config.dae 只负责 include，不能通过 API 修改；请编辑 config.d/ 下对应的模块文件。' },
  listener_secret_source: { title: '含 API 监听设置', desc: '该文件声明了 API listener 的 secret，只能在服务器上手动编辑。' },
  listener_secret_in_content: { title: '含 API secret', desc: '内容中出现了 API 的 secret，后端拒绝通过 API 保存这类内容。' },
  store_blocked: { title: '配置存储被锁定', desc: '上一次写入失败，需在服务器上处理后重新激活配置。' },
  redacted: { title: '内容已脱敏', desc: '读取到的内容中有被隐藏的 secret，不能作为替换内容保存。' },
}
/** 当前文件的只读原因；空字符串表示可写 */
const readOnlyReason = computed(() => {
  const s = current.value
  if (!s) return ''
  if (deniedReason.value && deniedReason.value !== 'entry_source') return deniedReason.value
  if (redacted[s.id]) return 'redacted'
  if (s.writable) return ''
  return s.read_only_reason || (s.kind === 'main' ? 'entry_source' : caps.value?.reason || 'writes_disabled')
})
const reasonInfo = computed(() => {
  const r = readOnlyReason.value
  return r ? REASONS[r] || { title: '只读', desc: `后端拒绝写入（${r}）。` } : null
})
/** 整体写入是否被关闭（影响所有文件；显示开启方法） */
const globalDenied = computed(() => ['writes_disabled', 'layout_unmanaged'].includes(readOnlyReason.value))

/* ---------- 校验 ---------- */
const diagnostics = ref([]) // 当前显示的诊断
const validState = ref('') // '' | 'ok' | 'invalid'
const validating = ref(false)
const focusLine = ref(0)
const editor = ref(null)

/** 诊断 → { 行号: 级别 }（只取当前文件的） */
const marks = computed(() => {
  const out = {}
  for (const d of diagnostics.value) {
    if (!d.line || !forCurrent(d)) continue
    if (out[d.line] !== 'error') out[d.line] = d.level === 'error' ? 'error' : 'warning'
  }
  return out
})
function forCurrent(d) {
  const s = current.value
  return !d.source_id || d.source_id === s?.id
}
const sourceLabel = (id) => {
  const s = sources.value.find((x) => x.id === id)
  return s ? s.path : id
}

/**
 * 组装校验请求：第一项必须是主源（契约要求）；编辑的是模块文件时一并附上主源原文，
 * 两项都带后端给的 id 与 path，诊断里的 source_id 即为对应文件
 */
function candidate() {
  const s = current.value
  const main = sources.value.find((x) => x.kind === 'main')
  const self = { id: s.id, path: s.path, content: text.value }
  if (!main || main.id === s.id) return [self]
  return [{ id: main.id, path: main.path, content: main.content }, self]
}

async function runValidate() {
  if (!current.value) return
  validating.value = true
  focusLine.value = 0
  try {
    const modes = caps.value?.validate || ['full']
    const r = await validateConfig(candidate(), modes.includes('full') ? 'full' : modes[0])
    diagnostics.value = r?.diagnostics || []
    validState.value = r?.valid ? 'ok' : 'invalid'
    if (r?.valid) toast.success(diagnostics.value.length ? `校验通过（${diagnostics.value.length} 条提示）` : '校验通过')
    else jumpToFirst()
  } catch (e) {
    if (e.status === 404) toast.warning(`当前 ${backend.engine} 不支持配置校验`)
    else toast.error(`校验失败：${errorMessage(e)}`)
  } finally {
    validating.value = false
  }
}

function jumpTo(d) {
  if (!d.line) return
  if (d.source_id && d.source_id !== current.value?.id && sources.value.some((s) => s.id === d.source_id)) {
    selectedId.value = d.source_id
  }
  focusLine.value = d.line
  nextTick(() => editor.value?.jumpTo(d.line, d.column))
}
function jumpToFirst() {
  const d = diagnostics.value.find((x) => x.level === 'error' && x.line && forCurrent(x))
  if (d) jumpTo(d)
}

/* ---------- 保存并重载 ---------- */
const saving = ref(false)
/** 412：{ latest: 磁盘上的新版本 } */
const conflict = ref(null)

async function save() {
  const s = current.value
  if (!s || readOnlyReason.value || !dirty.value) return
  const ok = await confirm.ask({
    title: `保存 ${shortName(s.path)} 并重载？`,
    message: `${backend.engine} 会先完整校验，通过后写入 ${s.path}（保留 .bak 备份）并重载配置；运行中的手动选择会恢复为配置中的值。`,
    confirmText: '保存并重载',
  })
  if (!ok) return
  saving.value = true
  conflict.value = null
  focusLine.value = 0
  try {
    await replaceConfigSource(s.id, text.value, s.content_sha256)
    delete drafts[s.id]
    diagnostics.value = []
    validState.value = ''
    toast.success(`${shortName(s.path)} 已保存，配置已重载`)
    emit('reloaded')
    await load({ silent: true })
  } catch (e) {
    const diags = diagnosticsOf(e)
    if (e.status === 412) {
      await showConflict()
    } else if (e.status === 422 && diags) {
      diagnostics.value = diags
      validState.value = 'invalid'
      toast.error('校验未通过，文件未改动')
      jumpToFirst()
    } else if (e.status === 403) {
      deniedReason.value = denyReasonOf(e) || 'writes_disabled'
      toast.warning(REASONS[deniedReason.value]?.title || '后端拒绝写入')
    } else if (e.status === 409) {
      toast.warning('已有重载正在进行，请稍后再保存')
    } else if (e.status === 428) {
      toast.error('后端要求 If-Match，请刷新后重试')
    } else {
      // reload 操作失败：后端会回滚或保留 .bak，这里提示原因并刷新文件
      if (diags) diagnostics.value = diags
      toast.error(`保存失败：${errorMessage(e)}`, { timeout: 8000 })
      load({ silent: true })
    }
  } finally {
    saving.value = false
  }
}

/** 读取磁盘上的最新版本，准备冲突提示 */
async function showConflict() {
  try {
    const cfg = await getEffectiveConfig()
    const latest = cfg?.sources?.find((x) => x.id === current.value?.id)
    conflict.value = { latest, cfg }
  } catch {
    conflict.value = { latest: null }
  }
}
/** 放弃本地修改，载入最新内容 */
function takeLatest() {
  const id = current.value?.id
  if (id) delete drafts[id]
  if (conflict.value?.cfg) config.value = conflict.value.cfg
  conflict.value = null
  diagnostics.value = []
  validState.value = ''
}
/** 保留本地修改，以最新版本为基准（下一次保存会覆盖他处的修改） */
function keepMine() {
  const id = current.value?.id
  const mine = drafts[id]
  if (conflict.value?.cfg) config.value = conflict.value.cfg
  if (id && mine !== undefined) drafts[id] = mine
  conflict.value = null
  toast.info('已以最新版本为基准，再次保存将覆盖他处的修改')
}

function revert() {
  const id = current.value?.id
  if (id) delete drafts[id]
  diagnostics.value = []
  validState.value = ''
  focusLine.value = 0
}

function select(id) {
  if (id === selectedId.value) return
  selectedId.value = id
  conflict.value = null
  focusLine.value = 0
  // 诊断与文件绑定：切换后只显示属于新文件的（marks 自动过滤）
}

const loadErrorInfo = computed(() => {
  if (!loadError.value) return null
  if (loadError.value.status === 404) {
    return { title: `当前 ${backend.engine} 不支持读取配置`, tips: ['需要 dae ≥ 2.1.2 并开启原生 API'] }
  }
  return describeError(loadError.value)
})
const errorCount = computed(() => diagnostics.value.filter((d) => d.level === 'error').length)
</script>

<template>
  <section class="card">
    <div class="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
      <h2 class="flex-1 whitespace-nowrap font-semibold">配置文件</h2>
      <span v-if="config?.revision" class="chip min-w-0 max-w-full truncate font-mono" title="配置 revision">rev {{ config.revision }}</span>
      <button class="btn-ghost py-1 text-xs" :disabled="loading" title="重新读取" @click="load({ silent: true })">
        <Icon name="refresh" class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
        刷新
      </button>
    </div>

    <div v-if="loading && !config" class="space-y-2 px-4 pb-4">
      <div class="skeleton h-8 rounded" />
      <div class="skeleton h-64 rounded" />
    </div>
    <EmptyState v-else-if="loadErrorInfo" icon="alert" :title="loadErrorInfo.title" :tips="loadErrorInfo.tips">
      <button class="btn-primary" @click="load()">重试</button>
    </EmptyState>

    <div v-else-if="current" class="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-[13rem_minmax(0,1fr)]">
      <!-- 文件列表：桌面竖排，手机横向滚动 -->
      <nav class="no-scrollbar -mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:overflow-visible md:px-0" aria-label="配置文件">
        <button
          v-for="s in sources"
          :key="s.id"
          class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-sm transition md:w-full"
          :class="s.id === selectedId ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
          :title="s.path"
          @click="select(s.id)"
        >
          <Icon :name="s.writable && !redacted[s.id] ? 'file' : 'lock'" class="h-4 w-4 shrink-0 opacity-70" />
          <span class="min-w-0 md:flex-1 md:truncate">{{ shortName(s.path) }}</span>
          <span v-if="isDirty(s)" class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="有未保存的修改" />
        </button>
        <p class="hidden px-2.5 pt-2 text-xs text-slate-400 md:block">
          <template v-if="caps?.hiddenSources?.length">{{ caps.hiddenSources.join('、') }} 由后端隐藏，只能在服务器上编辑。</template>
        </p>
      </nav>

      <div class="min-w-0 space-y-3">
        <!-- 文件信息 + 操作 -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm font-medium" :title="current.path">{{ current.path }}</div>
            <div class="text-xs text-slate-500">
              {{ formatBytes(current.bytes) }} · {{ current.line_count }} 行
              <template v-if="current.loaded_at"> · 载入于 {{ formatRelativeTime(current.loaded_at) }}</template>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button v-if="dirty" class="btn-ghost" :disabled="saving" @click="revert">还原</button>
            <button class="btn-outline" :disabled="validating || saving" @click="runValidate">
              <Icon name="check" class="h-4 w-4" :class="validating && 'animate-pulse'" />
              {{ validating ? '校验中…' : '校验' }}
            </button>
            <button
              v-if="!readOnlyReason"
              class="btn-primary"
              :disabled="!dirty || saving || validating"
              @click="save"
            >
              <Icon name="upload" class="h-4 w-4" :class="saving && 'animate-pulse'" />
              {{ saving ? '保存中…' : '保存并重载' }}
            </button>
          </div>
        </div>

        <!-- 只读说明 -->
        <div
          v-if="reasonInfo"
          class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40"
        >
          <div class="flex items-start gap-2">
            <Icon name="lock" class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div class="min-w-0">
              <div class="font-medium">只读模式：{{ reasonInfo.title }}</div>
              <div class="mt-0.5 text-slate-500">{{ reasonInfo.desc }}</div>
            </div>
          </div>
          <details v-if="globalDenied" class="mt-2 pl-6 text-slate-600 dark:text-slate-300" open>
            <summary class="cursor-pointer select-none text-xs font-medium text-brand-600 dark:text-brand-400">如何开启配置编辑</summary>
            <ol class="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
              <li>
                在 <code class="font-mono">api.dae</code> 的 api 段设置
                <code class="rounded bg-tile px-1 font-mono">config_write: true</code>（必须同时设置非空 secret），然后重启 {{ backend.engine }}。
              </li>
              <li>
                按受管布局拆分配置：入口 <code class="font-mono">config.dae</code> 只保留一个 include 块，引入
                <code class="font-mono">config.d/*.dae</code> 与 <code class="font-mono">api.dae</code>；
                <code class="font-mono">config.d/</code> 下必须有 global、subscription、node、group、routing、dns 六个 .dae 文件，且不再 include。
              </li>
              <li>每个段只能出现在一个文件里（例如 dns 段只写在 dns.dae）。</li>
              <li>
                配置文件权限设为 <code class="font-mono">0640</code> 或 <code class="font-mono">0600</code>（不能被同组写入、不能被其他用户访问），
                <code class="font-mono">config.d/</code> 目录需可写（写入时会生成 .bak 与临时文件）。
              </li>
            </ol>
            <pre class="mt-2 overflow-x-auto rounded-lg bg-tile p-2 font-mono text-[12px] leading-5">/etc/dae
├── config.dae      # include { config.d/*.dae  api.dae }
├── api.dae         # api 段，API 不可见
└── config.d
    ├── global.dae  subscription.dae  node.dae
    └── group.dae   routing.dae       dns.dae</pre>
          </details>
        </div>

        <!-- 412 冲突 -->
        <div
          v-if="conflict"
          class="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <Icon name="alert" class="h-4 w-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="font-medium">已被他处修改</div>
            <div class="text-xs opacity-80">读取之后，{{ current.path }} 在服务器上被改动过，本次保存没有写入。</div>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="btn-outline py-1 text-xs" @click="takeLatest">载入最新内容</button>
            <button class="btn-ghost py-1 text-xs" @click="keepMine">保留我的修改</button>
          </div>
        </div>

        <!-- 校验结果 -->
        <div
          v-if="validState === 'ok' && !errorCount"
          class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
        >
          <Icon name="check" class="h-4 w-4 shrink-0" />
          校验通过{{ dirty ? '，可以保存' : '' }}
        </div>
        <div v-if="diagnostics.length" class="overflow-hidden rounded-xl border border-rose-200 dark:border-rose-900/70">
          <div class="flex items-center gap-2 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            <Icon name="alert" class="h-4 w-4 shrink-0" />
            {{ errorCount ? `${errorCount} 个错误` : '提示' }}<span v-if="diagnostics.length > errorCount" class="font-normal opacity-80">，{{ diagnostics.length - errorCount }} 条提示</span>
            <span class="ml-auto text-xs font-normal opacity-70">点击跳转到对应行</span>
          </div>
          <ul class="max-h-40 divide-y divide-rose-100 overflow-y-auto text-sm dark:divide-rose-900/50">
            <li v-for="(d, i) in diagnostics" :key="i">
              <button
                class="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-rose-50/60 disabled:cursor-default dark:hover:bg-rose-950/30"
                :disabled="!d.line"
                @click="jumpTo(d)"
              >
                <span
                  class="mt-0.5 shrink-0 rounded px-1 font-mono text-[11px] font-semibold"
                  :class="d.level === 'error' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'"
                >
                  {{ d.line ? `${d.line}${d.column ? ':' + d.column : ''}` : '--' }}
                </span>
                <span class="min-w-0 flex-1 break-words">
                  {{ d.message }}
                  <span class="text-xs text-slate-400">
                    {{ d.code }}<template v-if="d.source_id && d.source_id !== current.id"> · {{ sourceLabel(d.source_id) }}</template>
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <CodeEditor
          ref="editor"
          v-model="text"
          :readonly="!!readOnlyReason || saving"
          :marks="marks"
          :focus-line="focusLine"
          class="h-[min(50svh,32rem)] min-h-[16rem]"
        />
      </div>
    </div>
    <EmptyState v-else icon="file" title="没有可显示的配置文件" />
  </section>
</template>
