<script setup>
/**
 * 全局 Toast 容器：手机端顶部居中，桌面端右上角
 */
import { useToastStore } from '@/stores/toast'
import Icon from './Icon.vue'

const toast = useToastStore()

// 底色跟随主题（卡片表面色 + 中性边框），只用图标颜色区分类型；成功用主题主色
const BASE = 'border-slate-200 bg-surface text-slate-700 dark:border-slate-700 dark:text-slate-200'
const STYLES = {
  info: { cls: BASE, icon: 'info', ic: 'text-slate-400' },
  success: { cls: BASE, icon: 'check', ic: 'text-brand-500' },
  warning: { cls: BASE, icon: 'alert', ic: 'text-amber-500' },
  error: { cls: BASE, icon: 'alert', ic: 'text-rose-500' },
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:right-4 md:items-end"
  >
    <TransitionGroup name="toast">
      <div
        v-for="t in toast.items"
        :key="t.id"
        class="pointer-events-auto flex w-full max-w-sm cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg"
        :class="STYLES[t.type]?.cls"
        @click="toast.remove(t.id)"
      >
        <Icon :name="STYLES[t.type]?.icon" class="mt-0.5 h-4 w-4 shrink-0" :class="STYLES[t.type]?.ic" />
        <span class="break-all">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
