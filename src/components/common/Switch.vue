<script setup>
/**
 * 开关组件
 * 用法：<Switch v-model="enabled" :loading="saving" />
 */
defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  /** 保存中：显示半透明并禁止点击 */
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled || loading"
    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed"
    :class="[
      modelValue ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
      (disabled || loading) && 'opacity-60',
    ]"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="inline-block h-5 w-5 rounded-full shadow transition-transform"
      :class="[modelValue ? 'translate-x-[22px] bg-on-brand' : 'translate-x-0.5 bg-white', loading && 'animate-pulse']"
    />
  </button>
</template>
