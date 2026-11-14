<script setup>
/**
 * 手机端「规则 / DNS」切换条（md 以下显示）
 * 底部导航只放 6 项（系统字体放大到 150% 时 7 项会挤），DNS 与分流规则同属“流量怎么走”，
 * 所以在手机上并入「规则」一项：两页顶部都有这条切换，底部导航的「规则」在两页都保持选中
 */
import Icon from '@/components/common/Icon.vue'

const ITEMS = [
  { to: '/rules', label: '分流规则', icon: 'list' },
  { to: '/dns', label: 'DNS', icon: 'compass' },
]
</script>

<template>
  <nav class="grid grid-cols-2 gap-0.5 rounded-lg bg-slate-200/70 p-0.5 text-sm md:hidden dark:bg-slate-800" aria-label="规则与 DNS">
    <RouterLink
      v-for="it in ITEMS"
      :key="it.to"
      :to="it.to"
      class="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md py-1 text-slate-500 transition"
      active-class="bg-white font-medium !text-slate-800 shadow-sm dark:bg-slate-900 dark:!text-slate-100"
    >
      <Icon :name="it.icon" class="h-4 w-4" />
      {{ it.label }}
    </RouterLink>
  </nav>
</template>
