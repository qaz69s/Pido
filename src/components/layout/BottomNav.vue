<script setup>
/**
 * 手机端底部导航（md 以下显示）
 */
import { navItems } from '@/router'
import Icon from '@/components/common/Icon.vue'
</script>

<template>
  <nav
    class="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-900/90"
  >
    <div class="grid grid-cols-6">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500 dark:text-slate-400"
        active-class="!text-brand-600 dark:!text-brand-400"
      >
        <Icon :name="item.icon" class="h-5 w-5" />
        {{ item.title }}
      </RouterLink>
    </div>
  </nav>
</template>
