<script setup>
/**
 * 设置项的一行：左边标题 + 说明，右边控件（插槽）
 */
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="flex items-center gap-4 px-4 py-3">
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium">{{ title }}</div>
      <div v-if="description" class="mt-0.5 text-xs text-slate-500">{{ description }}</div>
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
