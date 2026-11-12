<script setup>
/**
 * 根组件：布局
 * - /setup 页面不使用布局（meta.bare）
 * - 桌面端：左侧 Sidebar；手机端：底部 BottomNav
 * - 概览页、日志页用 KeepAlive 缓存：切走再回来，流量曲线和日志不会清空
 * - 页面切换带淡入动画（animations.css 的 .page-*）
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useBackendStore } from '@/stores/backend'
import { useThemeStore } from '@/stores/theme'
import { useMotionStore } from '@/stores/motion'
import Sidebar from '@/components/layout/Sidebar.vue'
import TopBar from '@/components/layout/TopBar.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import Toast from '@/components/common/Toast.vue'
import ErrorBanner from '@/components/common/ErrorBanner.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const route = useRoute()
const backend = useBackendStore()
useThemeStore() // 初始化主题（内部 watchEffect 会同步 <html class="dark">）
useMotionStore() // 初始化动画开关（同步 <html data-motion>）

const bare = computed(() => !!route.meta.bare)

// 启动时检测一次已保存的后端是否可用
onMounted(() => {
  if (backend.isConfigured) backend.check()
})
</script>

<template>
  <Toast />
  <ConfirmDialog />

  <RouterView v-if="bare" />

  <div v-else class="min-h-screen md:pl-56">
    <Sidebar />
    <div class="flex min-h-screen flex-col">
      <TopBar />
      <main class="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-3 sm:px-4 md:pb-8">
        <ErrorBanner class="mb-3" />
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <KeepAlive :include="['OverviewView', 'LogsView']">
              <component :is="Component" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
    </div>
    <BottomNav />
  </div>
</template>
