<script setup>
/**
 * 桌面端侧边栏（md 及以上显示）
 */
import { navItems } from '@/router'
import { useBackendStore } from '@/stores/backend'
import Icon from '@/components/common/Icon.vue'
import { useCoreLogo } from '@/composables/useCoreLogo'

const backend = useBackendStore()
/** 已连接时 Logo 显示对应内核图标 */
const coreLogo = useCoreLogo()
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-slate-200 bg-surface md:flex dark:border-slate-800 "
  >
    <!-- Logo：已连接时为内核图标，否则为 Pido 闪电图标 -->
    <div class="flex h-14 items-center gap-2 px-5 text-lg font-semibold">
      <img v-if="coreLogo" :src="coreLogo.src" :alt="coreLogo.name" :title="coreLogo.name" class="h-7 w-7 shrink-0 rounded-lg object-contain" />
      <span v-else class="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-on-brand">
        <Icon name="zap" class="h-4 w-4" />
      </span>
      Pido
    </div>

    <!-- 菜单 -->
    <nav class="flex-1 space-y-1 px-3 py-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        active-class="!bg-brand-50 !text-brand-700 font-medium dark:!bg-brand-500/10 dark:!text-brand-300"
      >
        <Icon :name="item.icon" class="h-[18px] w-[18px]" />
        <span class="flex-1">{{ item.title }}</span>
      </RouterLink>
    </nav>

    <!-- 当前后端 -->
    <RouterLink
      to="/setup"
      class="m-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
      title="修改后端设置"
    >
      <Icon name="server" class="h-4 w-4 shrink-0" />
      <span class="truncate">{{ backend.url }}</span>
    </RouterLink>
  </aside>
</template>
