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
    class="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-line bg-base-100 md:flex "
  >
    <!-- Logo：已连接时为内核图标，否则为 Pido 闪电图标 -->
    <div class="flex h-14 items-center gap-2.5 px-5 text-xl font-extrabold tracking-tight">
      <img v-if="coreLogo" :src="coreLogo.src" :alt="coreLogo.name" :title="coreLogo.name" class="h-7 w-7 shrink-0 rounded-lg object-contain" />
      <span v-else class="glow grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-content">
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
            class="min-h-11 gap-3 rounded-lg px-3 py-2 text-base font-semibold text-muted hover:!bg-line hover:!text-base-content"
            active-class="glow !bg-primary !text-primary-content"
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
      class="m-3 flex items-center gap-2 rounded-xl border border-line bg-base-200 px-3 py-2 text-xs text-muted hover:border-line-strong"
      title="修改后端设置"
    >
      <Icon name="server" class="h-4 w-4 shrink-0" />
      <span class="truncate">{{ backend.url }}</span>
    </RouterLink>
  </aside>
</template>
