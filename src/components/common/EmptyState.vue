<script setup>
/**
 * 空状态 / 错误状态占位
 */
import Icon from './Icon.vue'

defineProps({
  icon: { type: String, default: 'info' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  tips: { type: Array, default: () => [] },
})
</script>

<template>
  <div class="flex flex-col items-center px-4 py-12 text-center">
    <div class="mb-3 grid h-12 w-12 place-items-center rounded-full bg-tile text-slate-400">
      <Icon :name="icon" class="h-6 w-6" />
    </div>
    <h3 class="font-semibold">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-sm text-slate-500">{{ description }}</p>
    <ul v-if="tips.length" class="mt-3 max-w-lg list-disc space-y-1 pl-5 text-left text-sm text-slate-500">
      <li v-for="tip in tips" :key="tip">{{ tip }}</li>
    </ul>
    <div class="mt-4 flex gap-2"><slot /></div>
  </div>
</template>
