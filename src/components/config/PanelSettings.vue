<script setup>
/**
 * 配置页的「面板」设置：外观、配色、动画、当前后端（更换 / 断开）
 * mihomo 与 dae / honk 两种后端共用
 */
import { useRouter } from 'vue-router'
import { useBackendStore } from '@/stores/backend'
import { useThemeStore } from '@/stores/theme'
import { useMotionStore } from '@/stores/motion'
import { useConfirmStore } from '@/stores/confirm'
import Icon from '@/components/common/Icon.vue'
import Switch from '@/components/common/Switch.vue'
import SettingRow from '@/components/common/SettingRow.vue'
import { THEME_PRESETS } from '@/utils/themes'

const router = useRouter()
const backend = useBackendStore()
const theme = useThemeStore()
const motion = useMotionStore()
const confirm = useConfirmStore()

const THEMES = [
  { value: 'system', label: '跟随系统', icon: 'monitor' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
]

async function disconnect() {
  const ok = await confirm.ask({
    title: '断开当前后端？',
    message: '会清除本机保存的后端地址和 secret，之后需要重新填写。',
    confirmText: '断开',
    danger: true,
  })
  if (!ok) return
  backend.clear()
  router.replace('/setup')
}
</script>

<template>
  <!-- 面板 -->
  <section class="card divide-y divide-slate-100 dark:divide-slate-800">
    <h2 class="px-4 pb-2 pt-4 font-semibold">面板</h2>
    <SettingRow title="外观">
      <div class="flex rounded-lg bg-tile p-0.5 text-xs dark:bg-page">
        <button
          v-for="t in THEMES"
          :key="t.value"
          class="flex items-center gap-1 rounded-md px-2 py-1 transition"
          :class="theme.mode === t.value ? 'bg-white font-medium shadow-sm dark:bg-tile' : 'text-slate-500'"
          @click="theme.setMode(t.value, $event)"
        >
          <Icon :name="t.icon" class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{ t.label }}</span>
        </button>
      </div>
    </SettingRow>
    <!-- 配色方案：色块预览 + 名称，点击立即生效 -->
    <div class="px-4 py-3">
      <div class="mb-2 text-sm font-medium">配色</div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <button
          v-for="p in THEME_PRESETS"
          :key="p.id"
          class="group rounded-xl border p-2 text-left transition"
          :class="
            theme.preset === p.id
              ? 'border-brand-500 ring-2 ring-brand-500/25'
              : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
          "
          :title="p.desc"
          @click="theme.setPreset(p.id, $event)"
        >
          <div class="flex h-7 overflow-hidden rounded-md">
            <span class="flex-[2]" :style="{ background: p.swatch[0] }" />
            <span class="flex-[2]" :style="{ background: p.swatch[1] }" />
            <span class="flex-1" :style="{ background: p.swatch[2] }" />
          </div>
          <div class="mt-1.5 text-xs font-medium">{{ p.name }}</div>
        </button>
      </div>
    </div>
    <SettingRow title="动画效果" description="页面切换、展开、数字滚动等动画；系统开了「减少动画」时默认关闭">
      <Switch :model-value="motion.enabled" @update:model-value="motion.setEnabled" />
    </SettingRow>
    <div class="flex items-center gap-3 px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium">当前后端</div>
        <div class="mt-0.5 truncate font-mono text-xs text-slate-500">{{ backend.url }}</div>
        <div v-if="backend.isStandard" class="text-xs text-slate-500">
          后端 {{ backend.label || '--' }} · 原生 API
        </div>
        <div v-else class="text-xs text-slate-500">
          内核 {{ backend.version?.version || '--' }}{{ backend.version?.meta ? '（Meta）' : '' }}
        </div>
      </div>
      <RouterLink to="/setup" class="btn-outline py-1 text-xs">更换</RouterLink>
      <button class="btn-ghost py-1 text-xs text-rose-600 dark:text-rose-400" @click="disconnect">断开</button>
    </div>
  </section>
</template>
