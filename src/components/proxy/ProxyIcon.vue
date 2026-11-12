<script setup>
/**
 * 策略组图标：对应配置文件 proxy-groups 里的 icon 字段
 * - 支持 http(s) 图片地址、data: URI，以及直接写的 <svg> 代码
 * - 图片加载失败时自动隐藏，不留空白
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  icon: { type: String, default: '' },
  size: { type: Number, default: 20 },
})

const failed = ref(false)
watch(
  () => props.icon,
  () => (failed.value = false),
)

const src = computed(() => {
  const v = (props.icon || '').trim()
  if (!v) return ''
  if (/^<svg[\s>]/i.test(v)) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(v)}`
  if (/^(https?:|data:|\/|\.\/)/i.test(v)) return v
  return ''
})
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="shrink-0 rounded object-contain"
    alt=""
    loading="lazy"
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
</template>
