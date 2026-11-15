<script setup>
/**
 * 开关组件（daisyUI toggle）
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
  <!-- daisyUI toggle：保留 role="switch" 与 v-model 接口；保存中半透明并禁止点击 -->
  <input
    type="checkbox"
    role="switch"
    class="toggle toggle-primary shrink-0 rounded-full"
    :class="loading && 'animate-pulse'"
    :checked="modelValue"
    :aria-checked="modelValue"
    :disabled="disabled || loading"
    @change="(e) => { emit('update:modelValue', e.target.checked); e.target.checked = modelValue }"
  />
</template>
