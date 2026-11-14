<script setup>
/**
 * 手机端底部导航（md 以下显示）
 * - 选中项上方有一条指示条，切换时平滑滑过去
 * - 选中图标弹一下（animations.css 的 .nav-active）
 * - 固定 6 项：DNS 不单独占位，在手机上并入「规则」（路由 meta 见 router/index.js 的 phone / also）
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { navItems } from '@/router'
import Icon from '@/components/common/Icon.vue'

const route = useRoute()
/** 手机底部导航只放标记为可显示的项（DNS 从「规则」页顶部切换进入） */
const items = navItems.filter((n) => n.phone !== false)
const activeIndex = computed(() => items.findIndex((n) => n.path === route.path || n.also?.includes(route.path)))
</script>

<template>
  <nav
    class="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-surface/90 backdrop-blur md:hidden dark:border-slate-800 "
  >
    <div class="relative grid grid-cols-6">
      <!-- 指示条 -->
      <span
        v-show="activeIndex >= 0"
        class="pointer-events-none absolute -top-px left-0 flex h-0.5 justify-center transition-transform duration-300 ease-out"
        :style="{ width: `${100 / items.length}%`, transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }"
      >
        <span class="h-full w-8 rounded-full bg-brand-500" />
      </span>
      <RouterLink
        v-for="(item, i) in items"
        :key="item.path"
        :to="item.path"
        class="press flex flex-col items-center gap-0.5 whitespace-nowrap py-2 text-xs text-slate-500 transition dark:text-slate-400"
        :class="i === activeIndex && 'nav-active !text-brand-600 dark:!text-brand-400'"
      >
        <Icon :name="item.icon" class="h-5 w-5" />
        {{ item.title }}
      </RouterLink>
    </div>
  </nav>
</template>
