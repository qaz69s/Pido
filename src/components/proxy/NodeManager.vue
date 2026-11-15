<script setup>
/**
 * 节点管理弹窗（dae / honk，标准 API）
 * - 列表：某个节点来源（provider）下的节点；内联节点可改名 / 换链接 / 删除，订阅节点只读
 * - 表单：通过分享链接添加内联节点（POST /nodes），或编辑（PATCH /nodes/{id}，dae 扩展，链接留空表示不改）
 * - 写入都会排队 reload，完成后通知父组件刷新
 * 后端不回显节点链接（契约：响应不包含 link），所以编辑时链接框为空
 */
import { computed, reactive, ref, watch } from 'vue'
import { createNode, updateNode, deleteNode } from '@/api/standard/manage'
import { errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { delayLevel, delayText, DELAY_TEXT_CLASS } from '@/utils/format'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 打开时直接进入的视图：list（查看某来源的节点）| add（添加节点） */
  mode: { type: String, default: 'list' },
  /** 节点来源（ProxiesView 整理过的 provider：{ name, _id, _kind, proxies }）；添加模式可为空 */
  provider: { type: Object, default: null },
  /** 是否允许写入（capabilities.nodes.can_manage） */
  canManage: { type: Boolean, default: false },
  /** { 节点名: 延迟 } */
  delays: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const backend = useBackendStore()
const toast = useToastStore()
const confirm = useConfirmStore()

const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })

/** 内联来源（node 段）：可编辑；订阅 / 文件来源只读 */
const editable = computed(() => props.canManage && (!props.provider || props.provider._kind === 'inline'))
const nodes = computed(() => props.provider?.proxies || [])

/* ---------- 视图与表单 ---------- */
const view = ref('list') // list | form
const editing = ref(null) // 正在编辑的节点（null 为新建）
const form = reactive({ name: '', link: '' })
const formError = ref('')
const busy = ref(false)
const busyNode = ref('')

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    if (props.mode === 'add') startAdd()
    else view.value = 'list'
  },
)

function startAdd() {
  editing.value = null
  form.name = ''
  form.link = ''
  formError.value = ''
  view.value = 'form'
}
function startEdit(n) {
  editing.value = n
  form.name = n.name
  form.link = ''
  formError.value = ''
  view.value = 'form'
}
function back() {
  if (props.mode === 'add' && !props.provider) open.value = false
  else view.value = 'list'
}

/** 支持的分享链接协议（dae 文档列出的） */
const SCHEMES = ['vless', 'vmess', 'trojan', 'ss', 'ssr', 'socks', 'socks5', 'http', 'https', 'hysteria2', 'hy2', 'tuic', 'juicity', 'anytls', 'naive']
/** 从链接 # 后面取名字，方便添加时自动填名称 */
function onLinkInput() {
  if (editing.value || form.name) return
  const m = form.link.match(/#(.+)$/)
  if (m) {
    try {
      form.name = decodeURIComponent(m[1]).slice(0, 64)
    } catch {
      form.name = m[1].slice(0, 64)
    }
  }
}

function check() {
  const name = form.name.trim()
  const link = form.link.trim()
  if (!name) return '请填写节点名称'
  if (name.length > 64) return '名称最多 64 个字符'
  if (!editing.value && !link) return '请粘贴分享链接'
  if (link) {
    const scheme = link.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
    if (!scheme) return '链接格式不对，应形如 vless://… 、trojan://… 、ss://…'
    if (!SCHEMES.includes(scheme)) return `不支持的协议「${scheme}」`
    if (link.length > 8192) return '链接过长'
  }
  return ''
}

/** 后端错误 → 表单提示 */
function explain(e) {
  if (e.status === 409) return '名称或链接与已有节点重复（节点名全局唯一，订阅里的也算）'
  if (e.status === 422) return `后端无法解析：${e.detail?.error?.message || errorMessage(e)}`
  if (e.status === 404 && e.code === 'capability_not_supported') return editing.value ? '当前后端不支持编辑该节点（订阅节点只读，或后端版本过旧）' : '后端未开启节点管理（需要 config_write 与受管布局）'
  if (e.status === 403) return '后端拒绝写入：未开启配置写入或目录不是受管布局'
  return errorMessage(e)
}

async function submit() {
  formError.value = check()
  if (formError.value) return
  busy.value = true
  const name = form.name.trim()
  const link = form.link.trim()
  try {
    if (editing.value) {
      const patch = {}
      if (name !== editing.value.name) patch.name = name
      if (link) patch.link = link
      if (!Object.keys(patch).length) {
        view.value = 'list'
        return
      }
      await updateNode(editing.value._id, patch)
      toast.success(`节点 ${name} 已更新，配置已重载`)
    } else {
      await createNode(name, link)
      toast.success(`节点 ${name} 已添加，配置已重载`)
    }
    emit('changed')
    back()
  } catch (e) {
    formError.value = explain(e)
  } finally {
    busy.value = false
  }
}

async function remove(n) {
  const ok = await confirm.ask({
    title: `删除节点 ${n.name}？`,
    message: `会从 node 段删除这一行并重载配置。仍被策略组或 fallback 直接引用的节点无法删除。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  busyNode.value = n.name
  try {
    await deleteNode(n._id)
    toast.success(`节点 ${n.name} 已删除`)
    emit('changed')
  } catch (e) {
    if (e.status === 409) toast.error('该节点仍被策略组或 routing 的 fallback 直接引用，请先修改配置')
    else toast.error(`删除失败：${explain(e)}`)
  } finally {
    busyNode.value = ''
  }
}

const title = computed(() => {
  if (view.value === 'form') return editing.value ? `编辑节点 · ${editing.value.name}` : '添加节点'
  return props.provider ? `${props.provider.name} 的节点` : '节点'
})
</script>

<template>
  <Modal v-model="open" :title="title" width="md:max-w-xl">
    <!-- 表单 -->
    <form v-if="view === 'form'" id="node-form" class="space-y-3" @submit.prevent="submit">
      <div>
        <label class="label" for="node-link">分享链接</label>
        <textarea
          id="node-link"
          v-model="form.link"
          rows="3"
          class="input resize-none break-all font-mono text-[13px] leading-5"
          :placeholder="editing ? '留空表示不修改链接（后端不回显原链接）' : 'vless://… 、vmess://… 、trojan://… 、ss://… 、hysteria2://…'"
          spellcheck="false"
          autocomplete="off"
          @input="onLinkInput"
        />
        <p class="mt-1 text-xs text-slate-500">
          支持 vless、vmess、trojan、ss、ssr、socks、http、hysteria2、tuic、juicity、anytls、naive，须带主机与端口。
        </p>
      </div>
      <div>
        <label class="label" for="node-name">名称</label>
        <input id="node-name" v-model="form.name" class="input" maxlength="64" placeholder="例如 hk-03" autocomplete="off" />
        <p class="mt-1 text-xs text-slate-500">节点名全局唯一；改名不会同步修改其他文件里按名称引用它的组过滤 / 规则。</p>
      </div>
      <p v-if="formError" class="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0" />
        {{ formError }}
      </p>
      <p class="flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
        保存后写入 config.d/node.dae 的 node 段（保留 .bak）并重载 {{ backend.engine }}。
      </p>
    </form>

    <!-- 列表 -->
    <div v-else class="space-y-3">
      <p v-if="!editable" class="flex items-start gap-1.5 rounded-lg bg-tile px-3 py-2 text-xs text-slate-500">
        <Icon name="lock" class="mt-px h-3.5 w-3.5 shrink-0" />
        <span v-if="provider && provider._kind !== 'inline'">订阅节点只读：由订阅管理，只能通过更新订阅来变更。</span>
        <span v-else>后端未开启节点管理：需要在 api 段设置 config_write: true，且配置目录为受管布局。</span>
      </p>
      <ul v-if="nodes.length" class="divide-y divide-slate-100 dark:divide-slate-800">
        <li v-for="n in nodes" :key="n._id || n.name" class="flex items-center gap-2 py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium" :title="n.name">{{ n.name }}</div>
            <div class="text-xs text-slate-500">{{ n.type || '--' }}</div>
          </div>
          <span class="shrink-0 text-[13px] font-semibold tabular-nums" :class="DELAY_TEXT_CLASS[delayLevel(delays[n.name])]">
            {{ delayText(delays[n.name]) }}
          </span>
          <template v-if="editable">
            <button class="btn-icon h-8 w-8" title="编辑" :disabled="!!busyNode" @click="startEdit(n)">
              <Icon name="pencil" class="h-4 w-4" />
            </button>
            <button class="btn-icon h-8 w-8 hover:!text-rose-600" title="删除" :disabled="!!busyNode" @click="remove(n)">
              <Icon name="trash" class="h-4 w-4" :class="busyNode === n.name && 'animate-pulse'" />
            </button>
          </template>
        </li>
      </ul>
      <p v-else class="py-6 text-center text-sm text-slate-500">没有节点</p>
    </div>

    <template #footer>
      <template v-if="view === 'form'">
        <button class="btn-ghost" type="button" :disabled="busy" @click="back">{{ mode === 'add' && !provider ? '取消' : '返回' }}</button>
        <button class="btn-primary" type="submit" form="node-form" :disabled="busy">
          <Icon :name="editing ? 'check' : 'plus'" class="h-4 w-4" :class="busy && 'animate-pulse'" />
          {{ busy ? '保存中…' : editing ? '保存' : '添加' }}
        </button>
      </template>
      <template v-else>
        <button v-if="editable" class="btn-primary" @click="startAdd">
          <Icon name="plus" class="h-4 w-4" />
          添加节点
        </button>
        <button class="btn-ghost" @click="open = false">关闭</button>
      </template>
    </template>
  </Modal>
</template>
