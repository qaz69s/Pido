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
  <nav role="tablist" class="tabs tabs-boxed tabs-sm grid-cols-2 md:hidden" aria-label="规则与 DNS">
    <RouterLink
      v-for="it in ITEMS"
      :key="it.to"
      :to="it.to"
      role="tab"
      class="tab gap-1.5 whitespace-nowrap"
      active-class="tab-active font-medium"
    >
      <Icon :name="it.icon" class="h-4 w-4" />
      {{ it.label }}
    </RouterLink>
  </nav>
</template>
