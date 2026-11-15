<script setup>
/**
 * 策略组参数（dae / honk，标准 API）
 * - 只开放 check_interval（健康检查间隔，秒）与 tolerance（切换容差，毫秒）—— dae 目前只允许这两项
 * - 读取：GET /groups/{id}/config（ETag = 配置 revision）+ GET /groups/{id}（capabilities.mutable_config）
 * - 保存：PATCH /groups/{id}/config，JSON Patch + If-Match；202 后等待 group_update 操作（会 reload）
 * - 留空 = null：组不单独设置，沿用 global 段的 check_interval / check_tolerance
 * - 412：配置已被他处修改 → 提示并可重新读取
 */
import { computed, reactive, ref, watch } from 'vue'
import { getGroupConfig, getGroup, patchGroupConfig } from '@/api/standard/manage'
import { errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** ProxiesView 里的组：{ name, _id } */
  group: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'changed'])
const backend = useBackendStore()
const toast = useToastStore()
const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const stale = ref(false)
const doc = ref(null)
const etag = ref('')
const mutable = ref([])
const form = reactive({ check_interval: '', tolerance: '' })

async function load() {
  if (!props.group) return
  loading.value = true
  error.value = ''
  stale.value = false
  try {
    const [c, g] = await Promise.all([getGroupConfig(props.group._id), getGroup(props.group._id).catch(() => null)])
    doc.value = c.doc
    // 后端没给 ETag 时退回到组的 config_revision
    etag.value = c.etag || (g?.config_revision ? `"${g.config_revision}"` : '')
    mutable.value = g?.capabilities?.mutable_config || props.group._mutable || []
    form.check_interval = c.doc?.config?.check_interval ?? ''
    form.tolerance = c.doc?.config?.tolerance ?? ''
  } catch (e) {
    error.value = `读取失败：${errorMessage(e)}`
  } finally {
    loading.value = false
  }
}
watch(
  () => props.modelValue,
  (v) => v && load(),
)

const POLICY_LABEL = { selector: '手动选择', urltest: '自动（按延迟）', fallback: '故障转移', loadbalance: '负载均衡', random: '随机', score: '评分', fixed: '固定' }
const policyText = computed(() => {
  const p = doc.value?.policy
  if (!p) return '--'
  return `${POLICY_LABEL[p.kind] || p.kind}${p.native && p.native !== p.kind ? `（${p.native}）` : ''}`
})
const canInterval = computed(() => mutable.value.includes('check_interval'))
/** 契约：结果策略不是 URLTest 时，非空的 tolerance 会被拒绝 */
const isUrlTest = computed(() => doc.value?.policy?.kind === 'urltest')
const canTolerance = computed(() => mutable.value.includes('tolerance') && isUrlTest.value)
const readOnly = computed(() => !canInterval.value && !canTolerance.value)

/** 输入框 → 整数或 null（留空） */
const toVal = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

const fieldErrors = computed(() => {
  const e = {}
  const ci = toVal(form.check_interval)
  if (ci !== null && (!Number.isInteger(ci) || ci < 1)) e.check_interval = '须为 ≥ 1 的整数'
  const tol = toVal(form.tolerance)
  if (tol !== null && (!Number.isInteger(tol) || tol < 0)) e.tolerance = '须为 ≥ 0 的整数'
  return e
})

const ops = computed(() => {
  const cur = doc.value?.config || {}
  const out = []
  if (canInterval.value && toVal(form.check_interval) !== (cur.check_interval ?? null)) {
    out.push({ op: 'replace', path: '/config/check_interval', value: toVal(form.check_interval) })
  }
  if (canTolerance.value && toVal(form.tolerance) !== (cur.tolerance ?? null)) {
    out.push({ op: 'replace', path: '/config/tolerance', value: toVal(form.tolerance) })
  }
  return out
})

async function save() {
  if (Object.keys(fieldErrors.value).length || !ops.value.length) return
  saving.value = true
  error.value = ''
  stale.value = false
  try {
    await patchGroupConfig(props.group._id, ops.value, etag.value)
    toast.success(`${props.group.name} 参数已更新，配置已重载`)
    emit('changed')
    open.value = false
  } catch (e) {
    if (e.status === 412) {
      stale.value = true
      error.value = '已被他处修改：配置在读取之后发生了变化，本次修改没有保存。'
    } else if (e.status === 409) error.value = '该组有尚未完成的修改或重载，请稍后再试。'
    else if (e.status === 422) error.value = `后端不接受这个值：${e.detail?.error?.message || errorMessage(e)}`
    else if (e.status === 403 || e.status === 404) error.value = '后端未开启配置写入（需要 config_write 与受管布局），组参数只读。'
    else error.value = `保存失败：${errorMessage(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal v-model="open" :title="group ? `组参数 · ${group.name}` : '组参数'">
    <div v-if="loading" class="space-y-2 py-2">
      <div v-for="i in 3" :key="i" class="skeleton h-9 rounded" />
    </div>
    <form v-else id="group-params" class="space-y-4" @submit.prevent="save">
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="shrink-0 whitespace-nowrap text-slate-500">策略</span>
        <span class="min-w-0 break-words text-right font-medium">{{ policyText }}</span>
      </div>

      <div>
        <label class="label" for="gp-interval">健康检查间隔</label>
        <div class="flex items-center gap-2">
          <input
            id="gp-interval"
            v-model.number="form.check_interval"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="input tabular-nums"
            :class="fieldErrors.check_interval && '!border-rose-500'"
            :disabled="!canInterval || saving"
            placeholder="留空则沿用 global 设置"
          />
          <span class="shrink-0 text-sm text-slate-500">秒</span>
        </div>
        <p class="mt-1 text-xs" :class="fieldErrors.check_interval ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'">
          {{ fieldErrors.check_interval || (canInterval ? 'check_interval：多久探测一次组内节点' : '后端不允许修改此项') }}
        </p>
      </div>

      <div>
        <label class="label" for="gp-tol">切换容差</label>
        <div class="flex items-center gap-2">
          <input
            id="gp-tol"
            v-model.number="form.tolerance"
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            class="input tabular-nums"
            :class="fieldErrors.tolerance && '!border-rose-500'"
            :disabled="!canTolerance || saving"
            placeholder="留空则沿用 global 设置"
          />
          <span class="shrink-0 text-sm text-slate-500">毫秒</span>
        </div>
        <p class="mt-1 text-xs" :class="fieldErrors.tolerance ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'">
          {{
            fieldErrors.tolerance ||
            (canTolerance
              ? 'tolerance：新节点要比当前节点快这么多才切换，避免来回跳'
              : isUrlTest
                ? '后端不允许修改此项'
                : '只对按延迟自动选择（min_*）的策略生效')
          }}
        </p>
      </div>

      <p v-if="readOnly && !error" class="flex items-start gap-1.5 rounded-lg bg-tile px-3 py-2 text-xs text-slate-500">
        <Icon name="lock" class="mt-px h-3.5 w-3.5 shrink-0" />
        后端没有开放这个组的参数修改（需要 api 段 config_write: true 且配置目录为受管布局）。
      </p>
      <div
        v-if="error"
        class="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
        :class="stale ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'"
      >
        <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="min-w-0 flex-1">{{ error }}</span>
        <button v-if="stale" type="button" class="btn-outline shrink-0 py-0.5 text-xs" @click="load">重新读取</button>
      </div>
      <p class="flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
        保存会写入 config.d/group.dae 并重载 {{ backend.engine }}。
      </p>
    </form>

    <template #footer>
      <button class="btn-ghost" type="button" @click="open = false">取消</button>
      <button
        class="btn-primary"
        type="submit"
        form="group-params"
        :disabled="loading || saving || readOnly || !ops.length || !!Object.keys(fieldErrors).length"
      >
        <Icon name="check" class="h-4 w-4" :class="saving && 'animate-pulse'" />
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>
