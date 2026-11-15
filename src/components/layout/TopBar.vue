<script setup>
/**
 * 顶栏：页面标题、连接状态、主题切换、后端设置入口
 * - 手机端左上角 Logo：已连接时显示对应内核的图标（mihomo / dae / honk），未连接时显示 Pido 闪电图标
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
        dot: 'bg-success',
        text: backend.version?.version || '已连接',
        logo: CORE_LOGOS[backend.engine] || '',
        engine: CORE_NAMES[backend.engine] || backend.engine,
      }
    case 'checking':
    case 'unknown':
      return { dot: 'bg-warning animate-pulse', text: '检测中' }
    case 'error':
      return { dot: 'bg-error', text: '连接异常' }
    default:
      return { dot: 'bg-base-content/40', text: '未配置' }
  }
})

// 顶部栏平时通透无线，滚动后才出现毛玻璃和细线
const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 4)
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header
    class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 transition-[background-color,border-color] duration-200"
    :class="scrolled ? 'border-base-content/10 bg-base-300/80 backdrop-blur' : 'border-transparent bg-base-300'"
  >
    <!-- 手机端显示 Logo：已连接时为内核图标，否则为 Pido 闪电图标 -->
    <img
      v-if="statusInfo.logo"
      :src="statusInfo.logo"
      :alt="statusInfo.engine"
      :title="statusInfo.engine"
      class="h-7 w-7 shrink-0 rounded-lg object-contain md:hidden"
    />
    <span v-else class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-content md:hidden">
      <Icon name="zap" class="h-4 w-4" />
    </span>
    <h1 class="shrink-0 whitespace-nowrap text-lg font-semibold tracking-tight">{{ route.meta.title }}</h1>

    <div class="ml-auto flex items-center gap-1">
      <RouterLink
        to="/setup"
        class="press mr-1 flex items-center gap-1.5 rounded-full border border-base-content/10 bg-base-100 px-2.5 py-1 text-xs text-base-content/80 transition"
        :class="backend.status === 'error' && 'anim-shake'"
        :title="statusInfo.engine ? `${statusInfo.engine} ${statusInfo.text} · 后端设置` : '后端设置'"
      >
        <span class="h-2 w-2 rounded-full" :class="statusInfo.dot" />
        <span class="max-w-[9rem] truncate">{{ statusInfo.text }}</span>
      </RouterLink>
      <button
        class="btn btn-sm btn-ghost btn-square size-9"
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
