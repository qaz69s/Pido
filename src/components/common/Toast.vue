<script setup>
/**
 * 全局 Toast 容器：手机端顶部居中，桌面端右上角
 */
import { useToastStore } from '@/stores/toast'
import Icon from './Icon.vue'

const toast = useToastStore()

// daisyUI alert：底色跟随主题（base-100 + 细描边），只用图标颜色区分类型；成功用主题主色
const STYLES = {
  info: { icon: 'info', ic: 'text-base-content/60' },
  success: { icon: 'check', ic: 'text-primary' },
  warning: { icon: 'alert', ic: 'text-warning' },
  error: { icon: 'alert', ic: 'text-error' },
}
</script>

<template>
  <!-- daisyUI toast：手机端顶部居中，桌面端右上角 -->
  <div class="toast toast-center toast-top pointer-events-none z-[70] w-full max-w-sm items-stretch gap-2 p-3 md:left-auto md:right-0 md:translate-x-0 md:p-4">
    <TransitionGroup name="toast">
      <div
        v-for="t in toast.items"
        :key="t.id"
        role="alert"
        class="alert pointer-events-auto flex cursor-pointer items-start gap-2 whitespace-normal rounded-xl border-line bg-base-100 px-3 py-2.5 text-left text-sm text-base-content/90 shadow-lg"
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
  transition: all var(--dur-in) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
