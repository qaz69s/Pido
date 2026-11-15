<script setup>
/**
 * 手机端底部导航（md 以下显示）
 * - 选中项：图标后面一个主色淡底胶囊 + 图标变实心，切换时胶囊平滑滑过去
 * - 选中图标弹一下（animations.css 的 .nav-active）
 * - 固定 6 项：DNS 不单独占位，在手机上并入「规则」（路由 meta 见 router/index.js 的 phone / also）
 * - 文字用 11px 固定像素，系统字体放大时 6 项也不换行
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
    class="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-surface/90 backdrop-blur md:hidden dark:border-slate-800"
  >
    <div class="relative grid grid-cols-6 px-1">
      <!-- 胶囊高亮：宽度为一格，位于图标后方，随选中项平滑滑动 -->
      <span
        v-show="activeIndex >= 0"
        class="pointer-events-none absolute left-1 top-1.5 flex h-8 justify-center transition-transform duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)]"
        :style="{ width: `calc((100% - 0.5rem) / ${items.length})`, transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }"
      >
        <span class="h-full w-14 rounded-full bg-brand-500/15 dark:bg-brand-400/20" />
      </span>
      <RouterLink
        v-for="(item, i) in items"
        :key="item.path"
        :to="item.path"
        class="press relative flex flex-col items-center gap-1 whitespace-nowrap pb-1.5 pt-1.5 text-[11px] leading-none text-slate-500 transition-colors dark:text-slate-400"
        :class="i === activeIndex && 'nav-active font-semibold !text-brand-600 dark:!text-brand-300'"
      >
        <span class="grid h-8 w-14 place-items-center">
          <Icon :name="item.icon" :solid="i === activeIndex" class="h-5 w-5" />
        </span>
        {{ item.title }}
      </RouterLink>
    </div>
  </nav>
</template>
