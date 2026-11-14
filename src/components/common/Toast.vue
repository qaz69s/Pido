<script setup>
/**
 * 全局 Toast 容器：手机端顶部居中，桌面端右上角
 */
import { useToastStore } from '@/stores/toast'
import Icon from './Icon.vue'

const toast = useToastStore()

const STYLES = {
  info: { cls: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200', icon: 'info' },
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', icon: 'check' },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200', icon: 'alert' },
  error: { cls: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200', icon: 'alert' },
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
        <Icon :name="STYLES[t.type]?.icon" class="mt-0.5 h-4 w-4 shrink-0" />
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
