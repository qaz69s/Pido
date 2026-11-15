<script setup>
/**
 * 数值 + 单位：「12.4 MB/s」→ 数字正常显示，单位小一号、灰一级
 * 没有单位（纯数字或文字）时原样显示
 */
import { computed } from 'vue'

const props = defineProps({ value: { type: [String, Number], default: '' } })
const parts = computed(() => {
  const m = String(props.value ?? '').match(/^(-?[\d.,]+)\s*([^\d\s].*)$/)
  return m ? { n: m[1], u: m[2] } : null
})
</script>

<template>
  <span v-if="parts">{{ parts.n }}<span class="unit">{{ parts.u }}</span></span>
  <span v-else>{{ value }}</span>
</template>
