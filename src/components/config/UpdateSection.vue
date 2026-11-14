<script setup>
/**
 * 更新：面板与 mihomo 内核
 * - 面板：POST /upgrade/ui，由内核下载 external-ui-url 指向的 zip 并覆盖面板目录，完成后刷新页面
 * - 内核：POST /upgrade?channel=release|alpha，内核下载新版本、替换自身并重启；之后轮询 /version 等它回来
 * dae / honk（标准 API）：没有在线更新接口 —— 只显示面板版本与最新版本，提供 dist.zip 下载，
 *   由用户解压到 api { ui: … } 指向的目录；内核升级不显示（随系统包管理器升级）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { getVersion, upgradeCore, upgradeUi } from '@/api/configs'
import { errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import Icon from '@/components/common/Icon.vue'
import {
  PANEL_VERSION,
  PANEL_ZIP_URL,
  fetchLatestPanelVersion,
  fetchLatestRelease,
  fetchLatestAlpha,
  isAlphaVersion,
} from '@/utils/updates'

const backend = useBackendStore()
const toast = useToastStore()
const confirm = useConfirmStore()

const coreVersion = computed(() => backend.version?.version || '')

/** 升级通道：默认跟随当前内核（Alpha 内核默认选 Alpha） */
const channel = ref(isAlphaVersion(coreVersion.value) ? 'alpha' : 'release')
const CHANNELS = [
  { value: 'release', label: 'Release', desc: '正式版' },
  { value: 'alpha', label: 'Alpha', desc: '预览版' },
]

/** GitHub 上的最新版本，null = 未知 */
const latest = reactive({ panel: null, release: null, alpha: null })
const checking = ref(false)

async function checkLatest() {
  checking.value = true
  // 标准 API 后端不查 mihomo 的版本
  const tasks = backend.isStandard
    ? [['panel', fetchLatestPanelVersion]]
    : [
        ['panel', fetchLatestPanelVersion],
        ['release', fetchLatestRelease],
        ['alpha', fetchLatestAlpha],
      ]
  await Promise.all(
    tasks.map(async ([k, fn]) => {
      try {
        latest[k] = await fn()
      } catch {
        latest[k] = null
      }
    }),
  )
  checking.value = false
}
onMounted(checkLatest)

const latestCore = computed(() => latest[channel.value])
const panelHasUpdate = computed(() => latest.panel && latest.panel !== PANEL_VERSION)
const coreHasUpdate = computed(() => latestCore.value && coreVersion.value && latestCore.value !== coreVersion.value)

/* ---------- 更新面板 ---------- */
const upgradingUi = ref(false)

async function updatePanel() {
  const ok = await confirm.ask({
    title: '更新面板？',
    message:
      '内核会下载配置文件中 external-ui-url 指向的面板压缩包并覆盖当前面板，完成后自动刷新页面。' +
      (PANEL_ZIP_URL ? `\n\n请确认 external-ui-url 已设为：\n${PANEL_ZIP_URL}` : '') +
      '\n\n若未设置，内核会下载它的默认面板（MetaCubeXD）。',
    confirmText: '更新',
  })
  if (!ok) return
  upgradingUi.value = true
  try {
    await upgradeUi()
    toast.success('面板已更新，正在刷新…')
    setTimeout(() => location.reload(), 1200)
  } catch (e) {
    if (e.status === 404 || e.status === 405) toast.warning('当前内核不支持在线更新面板')
    else toast.error(`更新面板失败：${errorMessage(e)}`)
  } finally {
    upgradingUi.value = false
  }
}

/* ---------- 更新内核 ---------- */
const upgradingCore = ref(false)
const coreStage = ref('') // 进度文字

/** 内核重启期间轮询 /version，最多等 90 秒 */
async function waitForCore(oldVersion) {
  const deadline = Date.now() + 90000
  await new Promise((r) => setTimeout(r, 3000))
  while (Date.now() < deadline) {
    try {
      const v = await getVersion({ timeout: 3000, skipAuthHandler: true })
      // 版本号变化即升级完成；强制重装时版本不变，内核能响应就算完成
      if (v?.version && (v.version !== oldVersion || Date.now() > deadline - 84000)) return v.version
    } catch {
      /* 内核还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

async function updateCore(force = false) {
  const ch = CHANNELS.find((c) => c.value === channel.value)
  if (!force) {
    const ok = await confirm.ask({
      title: `升级到 ${ch.label}（${ch.desc}）？`,
      message:
        `当前：${coreVersion.value || '未知'}\n最新：${latestCore.value || '未知'}\n\n` +
        '内核会从 GitHub 下载新版本并自动重启，期间所有连接会中断。' +
        (channel.value === 'alpha' ? '\nAlpha 为开发预览版，可能不稳定。' : ''),
      confirmText: '升级',
      danger: channel.value === 'alpha',
    })
    if (!ok) return
  }
  upgradingCore.value = true
  coreStage.value = '下载中…'
  const old = coreVersion.value
  try {
    await upgradeCore(channel.value, force)
    coreStage.value = '重启中…'
    const v = await waitForCore(old)
    await backend.check()
    if (v) toast.success(`内核已升级到 ${v}`)
    else toast.warning('内核尚未恢复，请稍后刷新页面查看')
  } catch (e) {
    const msg = errorMessage(e)
    if (/already using latest/i.test(msg)) {
      const again = await confirm.ask({
        title: '已经是最新版本',
        message: `当前内核已是 ${ch.label} 最新版本，是否强制重新安装？`,
        confirmText: '强制重装',
      })
      if (again) {
        upgradingCore.value = false
        return updateCore(true)
      }
    } else if (e.status === 404 || e.status === 405) {
      toast.warning('当前内核不支持在线升级（可能运行在嵌入模式）')
    } else {
      toast.error(`升级失败：${msg}`)
    }
  } finally {
    upgradingCore.value = false
    coreStage.value = ''
  }
}
</script>

<template>
  <section class="card divide-y divide-slate-100 dark:divide-slate-800">
    <div class="flex items-center gap-2 px-4 pb-2 pt-4">
      <h2 class="flex-1 font-semibold">更新</h2>
      <button class="btn-ghost py-1 text-xs" :disabled="checking" @click="checkLatest">
        <Icon name="refresh" class="h-3.5 w-3.5" :class="checking && 'animate-spin'" />
        检查更新
      </button>
    </div>

    <!-- 面板 -->
    <div class="flex items-center gap-4 px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-sm font-medium">
          面板
          <span v-if="panelHasUpdate" class="rounded-full px-1.5 py-0.5 text-xs font-medium bg-brand-500/10 text-brand-600 dark:text-brand-400">有新版本</span>
        </div>
        <div class="mt-0.5 text-xs text-slate-500">
          当前 <span class="font-mono">{{ PANEL_VERSION }}</span>
          <template v-if="latest.panel"> · 最新 <span class="font-mono">{{ latest.panel }}</span></template>
        </div>
      </div>
      <button v-if="!backend.isStandard" class="btn-outline py-1 text-xs" :disabled="upgradingUi" @click="updatePanel">
        <Icon name="download" class="h-3.5 w-3.5" :class="upgradingUi && 'animate-pulse'" />
        {{ upgradingUi ? '更新中…' : '更新面板' }}
      </button>
      <!-- 标准 API：后端不提供在线更新面板，给出下载链接 -->
      <a v-else-if="PANEL_ZIP_URL" class="btn-outline py-1 text-xs" :href="PANEL_ZIP_URL" target="_blank" rel="noopener">
        <Icon name="download" class="h-3.5 w-3.5" />
        下载面板
      </a>
    </div>
    <p v-if="backend.isStandard" class="px-4 py-3 text-xs text-slate-500">
      {{ backend.engine }} 不支持在线更新面板：下载 dist.zip 解压到 api 段 ui 指向的目录（覆盖原文件），然后刷新本页即可。
    </p>

    <!-- 内核（mihomo 专属） -->
    <div v-if="!backend.isStandard" class="space-y-3 px-4 py-3">
      <div class="flex items-center gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-sm font-medium">
            mihomo 内核
            <span v-if="coreHasUpdate" class="rounded-full px-1.5 py-0.5 text-xs font-medium bg-brand-500/10 text-brand-600 dark:text-brand-400">有新版本</span>
          </div>
          <div class="mt-0.5 text-xs text-slate-500">
            当前 <span class="font-mono">{{ coreVersion || '--' }}</span>
            <template v-if="latestCore"> · 最新 <span class="font-mono">{{ latestCore }}</span></template>
          </div>
        </div>
        <button
          :class="channel === 'alpha' ? 'btn-danger' : 'btn-primary'"
          class="py-1 text-xs"
          :disabled="upgradingCore"
          @click="updateCore()"
        >
          <Icon name="arrowUp" class="h-3.5 w-3.5" :class="upgradingCore && 'animate-pulse'" />
          {{ upgradingCore ? coreStage : '升级内核' }}
        </button>
      </div>
      <!-- 通道选择 -->
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="c in CHANNELS"
          :key="c.value"
          class="rounded-xl border px-3 py-2 text-left transition"
          :class="
            channel === c.value
              ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-500/10'
              : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
          "
          :disabled="upgradingCore"
          @click="channel = c.value"
        >
          <div class="text-sm font-medium">{{ c.label }}</div>
          <div class="text-xs text-slate-500">
            {{ c.desc }}<template v-if="latest[c.value]"> · <span class="font-mono">{{ latest[c.value] }}</span></template>
          </div>
        </button>
      </div>
    </div>
  </section>
</template>
