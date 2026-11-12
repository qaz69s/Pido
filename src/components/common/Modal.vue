<script setup>
/**
 * 通用弹窗
 * - 手机端：底部抽屉；桌面端：居中对话框
 * - 点击遮罩或按 Esc 关闭；打开时锁定页面滚动
 * 用法：<Modal v-model="open" title="标题"> 内容 <template #footer>按钮</template></Modal>
 */
import { watch, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** 对话框最大宽度（Tailwind 类） */
  width: { type: String, default: 'md:max-w-lg' },
})
const emit = defineEmits(['update:modelValue'])

const close = () => emit('update:modelValue', false)

function onKey(e) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.modelValue,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
)
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" @click="close" />
        <!-- 面板 -->
        <div
          class="modal-panel relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl md:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
          :class="width"
          role="dialog"
          aria-modal="true"
        >
          <header class="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <h3 class="min-w-0 flex-1 truncate font-semibold">{{ title }}</h3>
            <button class="btn-icon -mr-2 h-8 w-8" title="关闭" @click="close">
              <Icon name="x" class="h-5 w-5" />
            </button>
          </header>
          <div class="flex-1 overflow-y-auto px-4 py-3">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            class="safe-bottom flex justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: translateY(24px);
}
</style>
