<script setup>
/**
 * 顶栏：页面标题、连接状态、主题切换、后端设置入口
 * - 已连接时状态胶囊显示对应内核的图标（mihomo / dae / honk），右下角小圆点表示连接状态
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useBackendStore } from '@/stores/backend'
import { useThemeStore } from '@/stores/theme'
import Icon from '@/components/common/Icon.vue'
import mihomoLogo from '@/assets/cores/mihomo.png'
import daeLogo from '@/assets/cores/dae.png'
import honkLogo from '@/assets/cores/honk.png'

/** 内核图标；honk 暂无独立 Logo，使用 daeuniverse 组织图标 */
const CORE_LOGOS = { mihomo: mihomoLogo, dae: daeLogo, honk: honkLogo }
const CORE_NAMES = { mihomo: 'mihomo', dae: 'dae', honk: 'honk' }

const route = useRoute()
const backend = useBackendStore()
const theme = useThemeStore()

const THEME_META = {
  system: { icon: 'monitor', label: '跟随系统' },
  light: { icon: 'sun', label: '浅色' },
  dark: { icon: 'moon', label: '深色' },
}

/** 状态指示：圆点颜色 + 文字 */
const statusInfo = computed(() => {
  switch (backend.status) {
    case 'ok':
      return {
        dot: 'bg-emerald-500 anim-breathe',
        text: backend.version?.version || '已连接',
        logo: CORE_LOGOS[backend.engine] || '',
        engine: CORE_NAMES[backend.engine] || backend.engine,
      }
    case 'checking':
    case 'unknown':
      return { dot: 'bg-amber-400 animate-pulse', text: '检测中' }
    case 'error':
      return { dot: 'bg-rose-500', text: '连接异常' }
    default:
      return { dot: 'bg-slate-400', text: '未配置' }
  }
})
</script>

<template>
  <header
    class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-page/80 px-4 backdrop-blur dark:border-slate-800/80 "
  >
    <!-- 手机端显示 Logo -->
    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-on-brand md:hidden">
      <Icon name="zap" class="h-4 w-4" />
    </span>
    <h1 class="shrink-0 whitespace-nowrap text-base font-semibold">{{ route.meta.title }}</h1>

    <div class="ml-auto flex items-center gap-1">
      <RouterLink
        to="/setup"
        class="press mr-1 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        :class="[backend.status === 'error' && 'anim-shake', statusInfo.logo && 'pl-1']"
        :title="statusInfo.engine ? `${statusInfo.engine} ${statusInfo.text} · 后端设置` : '后端设置'"
      >
        <!-- 已连接：内核图标 + 状态小圆点；其他状态只显示圆点 -->
        <span v-if="statusInfo.logo" class="relative h-5 w-5 shrink-0">
          <img :src="statusInfo.logo" :alt="statusInfo.engine" class="h-5 w-5 rounded-full bg-white object-cover ring-1 ring-black/5 dark:ring-white/10" />
          <span class="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900" :class="statusInfo.dot" />
        </span>
        <span v-else class="h-2 w-2 rounded-full" :class="statusInfo.dot" />
        <span class="max-w-[9rem] truncate">{{ statusInfo.text }}</span>
      </RouterLink>
      <button
        class="btn-icon"
        :title="`主题：${THEME_META[theme.mode].label}（点击切换）`"
        @click="theme.cycle($event)"
      >
        <Transition name="page" mode="out-in">
          <Icon :key="theme.mode" :name="THEME_META[theme.mode].icon" class="h-5 w-5" />
        </Transition>
      </button>
    </div>
  </header>
</template>
