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
    class="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-base-content/10 bg-base-100 md:flex "
  >
    <!-- Logo：已连接时为内核图标，否则为 Pido 闪电图标 -->
    <div class="flex h-14 items-center gap-2 px-5 text-lg font-semibold">
      <img v-if="coreLogo" :src="coreLogo.src" :alt="coreLogo.name" :title="coreLogo.name" class="h-7 w-7 shrink-0 rounded-lg object-contain" />
      <span v-else class="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-content">
        <Icon name="zap" class="h-4 w-4" />
      </span>
      Pido
    </div>

    <!-- 菜单 -->
    <nav class="flex-1 px-3 py-2">
      <ul class="menu w-full gap-1 p-0">
        <li v-for="item in navItems" :key="item.path">
          <RouterLink
            :to="item.path"
            class="gap-3 px-3 py-2 text-sm text-base-content/80"
            active-class="!bg-primary/10 !text-primary font-medium"
          >
            <Icon :name="item.icon" class="h-5 w-5" />
            <span class="flex-1">{{ item.title }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <!-- 当前后端 -->
    <RouterLink
      to="/setup"
      class="m-3 flex items-center gap-2 rounded-lg border border-base-content/10 px-3 py-2 text-xs text-base-content/70 hover:bg-base-content/5"
      title="修改后端设置"
    >
      <Icon name="server" class="h-4 w-4 shrink-0" />
      <span class="truncate">{{ backend.url }}</span>
    </RouterLink>
  </aside>
</template>
