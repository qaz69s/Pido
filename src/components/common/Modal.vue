<script>
/** 所有 Modal 实例共享的“打开栈” */
const stack = []
</script>

<script setup>
/**
 * 通用弹窗
 * - 手机端：底部抽屉；桌面端：居中对话框
 * - 点击遮罩或按 Esc 关闭；打开时锁定页面滚动
 * 用法：<Modal v-model="open" title="标题"> 内容 <template #footer>按钮</template></Modal>
 * - 可叠加：确认框（ConfirmDialog）层级更高；滚动锁按打开的弹窗计数，关掉上层不会解锁下层；Esc 只关最上层
 */
import { watch, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** 对话框最大宽度（Tailwind 类） */
  width: { type: String, default: 'md:max-w-lg' },
  /** 层级（Tailwind 类）；确认框用更高的层级，压在其他弹窗之上 */
  z: { type: String, default: 'z-50' },
})
const emit = defineEmits(['update:modelValue'])

const close = () => emit('update:modelValue', false)

/* 打开中的弹窗栈（模块级共享）：滚动锁与 Esc 都只看栈顶 */
const token = Symbol('modal')
function push() {
  stack.push(token)
  document.body.style.overflow = 'hidden'
}
function pop() {
  const i = stack.indexOf(token)
  if (i >= 0) stack.splice(i, 1)
  if (!stack.length) document.body.style.overflow = ''
}

function onKey(e) {
  if (e.key === 'Escape' && stack[stack.length - 1] === token) close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      push()
      window.addEventListener('keydown', onKey)
    } else {
      pop()
      window.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  pop()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 flex items-end justify-center md:items-center md:p-4" :class="z">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" @click="close" />
        <!-- 面板 -->
        <div
          class="modal-panel relative flex max-h-[85svh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl md:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
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
