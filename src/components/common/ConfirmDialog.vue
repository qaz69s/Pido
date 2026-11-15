<script setup>
/**
 * 全局确认框，挂在 App.vue 中，由 stores/confirm.js 驱动
 */
import { computed } from 'vue'
import { useConfirmStore } from '@/stores/confirm'
import Modal from './Modal.vue'

const confirm = useConfirmStore()

// 点遮罩 / Esc 关闭视为“取消”
const open = computed({
  get: () => confirm.open,
  set: (v) => !v && confirm.settle(false),
})
</script>

<template>
  <Modal v-model="open" :title="confirm.options.title" width="md:max-w-sm" z="z-[60]">
    <p v-if="confirm.options.message" class="whitespace-pre-line break-all text-sm text-base-content/80">
      {{ confirm.options.message }}
    </p>
    <template #footer>
      <button class="btn btn-sm btn-outline border-base-content/20" @click="confirm.settle(false)">取消</button>
      <button :class="confirm.options.danger ? 'btn-error' : 'btn-primary'" @click="confirm.settle(true)" class="btn btn-sm">
        {{ confirm.options.confirmText }}
      </button>
    </template>
  </Modal>
</template>
