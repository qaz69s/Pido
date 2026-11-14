<script setup>
/**
 * 配置页（dae / honk，标准 API）
 * - 后端信息：引擎与版本、API、构建、运行时长、数据面、配置代次、上次重载、降级项（GET /api/v1/runtime）
 * - 维护：重载配置（POST /api/v1/operations/reload，轮询 operation 直到完成）
 * - 更新：面板版本（标准 API 没有在线更新接口，见 UpdateSection）
 * - 面板：外观、配色、动画、当前后端
 * - 配置文件：查看 / 校验 / 保存并重载各配置源（ConfigEditor.vue，需后端开启 config_write 且为受管布局）
 * mihomo 专属的运行模式、TUN、端口、GEO 更新、内核升级等不显示；DNS 在独立的 DNS 页
 */
import { computed, ref, onMounted } from 'vue'
import { reloadStandard } from '@/api/configs'
import { getRuntime } from '@/api/standard/data'
import { describeError, errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { formatDuration, formatRelativeTime } from '@/utils/format'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import SettingRow from '@/components/common/SettingRow.vue'
import UpdateSection from './UpdateSection.vue'
import PanelSettings from './PanelSettings.vue'
import ConfigEditor from './ConfigEditor.vue'

const backend = useBackendStore()
const toast = useToastStore()
const confirm = useConfirmStore()

/* ---------- 运行信息 ---------- */
const runtime = ref(null)
const loading = ref(true)
const loadError = ref(null)

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    runtime.value = await getRuntime()
    loadError.value = null
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
}
onMounted(load)

const DATAPATH_STATE = { active: '运行中', degraded: '降级', inactive: '未启用', starting: '启动中', stopped: '已停止', failed: '失败' }
const LIFECYCLE_STATE = { running: '运行中', suspended: '已暂停', starting: '启动中', stopping: '停止中', reloading: '重载中' }
const RELOAD_STATUS = { succeeded: '成功', failed: '失败', running: '进行中', queued: '排队中' }

const rows = computed(() => {
  const r = runtime.value || {}
  const v = backend.version || {}
  const dp = r.datapath
  const rev = v.build?.revision
  return [
    { label: '后端', value: backend.label || '--' },
    { label: '接口', value: v.api ? `${v.api.name} v${v.api.major}${v.api.status ? `（${v.api.status}）` : ''}` : '--', mono: true },
    { label: '构建', value: rev ? String(rev).slice(0, 12) : '--', mono: true },
    { label: '状态', value: LIFECYCLE_STATE[r.lifecycle?.state] || r.lifecycle?.state || '--' },
    { label: '运行时长', value: r.lifecycle?.started_at ? formatDuration(r.lifecycle.started_at) : '--' },
    {
      label: '数据面',
      value: dp ? `${dp.kind === 'ebpf' ? 'eBPF' : dp.kind || ''} · ${DATAPATH_STATE[dp.state] || dp.state || '--'}` : '--',
    },
    { label: '配置代次', value: r.generation?.active_id ?? '--', mono: true },
    { label: 'CPU', value: r.process?.cpu_percent != null ? `${r.process.cpu_percent}%` : '--' },
  ]
})

const lastReload = computed(() => runtime.value?.last_reload || null)
const degradations = computed(() => runtime.value?.degradations || [])

/* ---------- 重载配置 ---------- */
const reloading = ref(false)
async function reload() {
  const ok = await confirm.ask({
    title: '重新加载配置？',
    message: `${backend.engine} 会重新读取配置文件并生成新的路由代次；运行时的手动选择（如策略组切换）会恢复为配置中的值。`,
    confirmText: '重载',
  })
  if (!ok) return
  reloading.value = true
  try {
    await reloadStandard()
    toast.success('配置已重载')
  } catch (e) {
    if (e.status === 409) toast.warning('已有重载正在进行，请稍后再试')
    else if (e.status === 404) toast.warning(`当前 ${backend.engine} 不支持通过 API 重载配置`)
    else toast.error(`重载失败：${errorMessage(e)}`)
  } finally {
    reloading.value = false
    load({ silent: true })
  }
}

const loadErrorInfo = computed(() => (loadError.value ? describeError(loadError.value) : null))
</script>

<template>
  <div class="space-y-4">
    <p class="flex items-start gap-1.5 text-xs text-slate-500">
      <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
      已连接 {{ backend.engine }} 的原生 API。运行模式、TUN、端口等 mihomo 专属设置不适用；配置在下方按文件编辑，保存后自动重载。
    </p>

    <!-- 配置文件编辑 -->
    <ConfigEditor @reloaded="load({ silent: true })" />

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 左列 -->
      <div class="space-y-4">
        <!-- 后端信息 -->
        <section class="card">
          <div class="flex items-center gap-2 px-4 pb-2 pt-4">
            <h2 class="flex-1 font-semibold">后端信息</h2>
            <button class="btn-ghost py-1 text-xs" :disabled="loading" @click="load({ silent: true })">
              <Icon name="refresh" class="h-3.5 w-3.5" :class="loading && 'animate-spin'" />
              刷新
            </button>
          </div>
          <div v-if="loading" class="space-y-2 px-4 pb-4">
            <div v-for="i in 5" :key="i" class="skeleton h-6 rounded" />
          </div>
          <EmptyState v-else-if="loadErrorInfo" icon="alert" :title="loadErrorInfo.title" :tips="loadErrorInfo.tips">
            <button class="btn-primary" @click="load()">重试</button>
          </EmptyState>
          <dl v-else class="divide-y divide-slate-100 px-4 pb-2 text-sm dark:divide-slate-800">
            <div v-for="row in rows" :key="row.label" class="flex justify-between gap-3 py-2.5">
              <dt class="shrink-0 text-slate-500">{{ row.label }}</dt>
              <dd class="min-w-0 truncate text-right font-medium tabular-nums" :class="row.mono && 'font-mono text-[13px]'" :title="String(row.value)">
                {{ row.value }}
              </dd>
            </div>
          </dl>
        </section>

        <!-- 降级项：后端报告的不完整 / 受限功能 -->
        <section v-if="degradations.length" class="card p-4">
          <h2 class="mb-2 font-semibold">运行提示</h2>
          <ul class="space-y-2 text-sm">
            <li v-for="d in degradations" :key="d.code" class="flex items-start gap-2">
              <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div class="min-w-0">
                <div class="break-words">{{ d.message || d.code }}</div>
                <div class="text-xs text-slate-500">
                  <span class="font-mono">{{ d.code }}</span>
                  <template v-if="d.since"> · {{ formatRelativeTime(d.since) }}</template>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- 右列 -->
      <div class="space-y-4">
        <!-- 维护 -->
        <section class="card divide-y divide-slate-100 dark:divide-slate-800">
          <h2 class="px-4 pb-2 pt-4 font-semibold">维护</h2>
          <SettingRow title="重载配置" description="重新读取磁盘上的配置文件，生成新的路由代次">
            <button class="btn-outline py-1 text-xs" :disabled="reloading" @click="reload">
              <Icon name="file" class="h-3.5 w-3.5" :class="reloading && 'animate-pulse'" />
              {{ reloading ? '重载中…' : '执行' }}
            </button>
          </SettingRow>
          <div v-if="lastReload" class="px-4 py-3 text-xs text-slate-500">
            上次重载：
            <span :class="lastReload.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'">
              {{ RELOAD_STATUS[lastReload.status] || lastReload.status }}
            </span>
            <template v-if="lastReload.finished_at"> · {{ formatRelativeTime(lastReload.finished_at) }}</template>
            <div v-if="lastReload.error" class="mt-1 break-words text-rose-600 dark:text-rose-400">
              {{ lastReload.error.message || lastReload.error.code || lastReload.error }}
            </div>
          </div>
        </section>

        <!-- 更新：面板版本（标准 API 没有在线更新接口） -->
        <UpdateSection />

        <!-- 面板：外观、配色、动画、当前后端 -->
        <PanelSettings />
      </div>
    </div>
  </div>
</template>
