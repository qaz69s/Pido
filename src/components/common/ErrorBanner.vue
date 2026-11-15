<script setup>
/**
 * 后端连接异常时显示在页面顶部的提示条
 */
import { computed, ref } from 'vue'
import { useBackendStore } from '@/stores/backend'
import { describeError } from '@/api/http'
import Icon from './Icon.vue'

const backend = useBackendStore()
const retrying = ref(false)
const info = computed(() => (backend.lastError ? describeError(backend.lastError) : null))

async function retry() {
  retrying.value = true
  await backend.check()
  retrying.value = false
}
</script>

<template>
  <div
    v-if="backend.status === 'error' && info"
    class="flex flex-col gap-2 rounded-xl border border-danger-soft bg-danger-soft p-3 text-sm text-danger sm:flex-row sm:items-center"
  >
    <div class="flex flex-1 items-start gap-2">
      <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div class="font-medium">{{ info.title }}</div>
        <div v-if="info.tips[0]" class="mt-0.5 text-xs opacity-80">{{ info.tips[0] }}</div>
      </div>
    </div>
    <div class="flex gap-2 self-end sm:self-auto">
      <button class="btn-outline py-1 text-xs" :disabled="retrying" @click="retry">
        {{ retrying ? '检测中…' : '重试' }}
      </button>
      <RouterLink to="/setup" class="btn-primary py-1 text-xs">修改设置</RouterLink>
    </div>
  </div>
</template>
