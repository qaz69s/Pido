<script setup>
/**
 * 手机端底部导航（md 以下显示）
 * - 选中态只靠主色 + 图标加粗，不再叠加顶部指示条
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
    class="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base-100/90 backdrop-blur-xl backdrop-saturate-150 md:hidden "
  >
    <div class="relative grid grid-cols-6">
      <RouterLink
        v-for="(item, i) in items"
        :key="item.path"
        :to="item.path"
        class="press flex flex-col items-center gap-0.5 whitespace-nowrap py-2 text-xs font-semibold text-muted transition"
        :class="i === activeIndex && 'nav-active !text-primary font-bold'"
      >
        <Icon :name="item.icon" class="h-5 w-5" :class="i !== activeIndex && 'text-base-content/60'" />
        {{ item.title }}
      </RouterLink>
    </div>
  </nav>
</template>
