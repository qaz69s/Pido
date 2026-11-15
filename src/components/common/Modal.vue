<script>
/** 所有 Modal 实例共享的“打开栈” */
const stack = []
</script>

<script setup>
/**
 * 通用弹窗（daisyUI modal）
 * - 手机端：底部抽屉；桌面端：居中对话框
 * - 点击遮罩或按 Esc 关闭；打开时锁定页面滚动
 * 用法：<Modal v-model="open" title="标题"> 内容 <template #footer>按钮</template></Modal>
 * - 可叠加：确认框（ConfirmDialog）层级更高；滚动锁按打开的弹窗计数，关掉上层不会解锁下层；Esc 只关最上层
 */
import { ref, watch, onBeforeUnmount } from 'vue'
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

/* 手机端底部抽屉：按住顶部把手 / 标题栏下拉关闭（超过 80px 或快速下滑） */
const dragY = ref(0)
let startY = null
let startT = 0
function onDragStart(e) {
  if (window.matchMedia('(min-width: 768px)').matches) return
  startY = e.touches[0].clientY
  startT = Date.now()
}
function onDragMove(e) {
  if (startY === null) return
  dragY.value = Math.max(0, e.touches[0].clientY - startY)
}
function onDragEnd() {
  if (startY === null) return
  const fast = dragY.value > 30 && Date.now() - startT < 250
  if (dragY.value > 80 || fast) close()
  startY = null
  dragY.value = 0
}

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
      <!-- daisyUI modal：手机端 modal-bottom（底部抽屉），桌面端 modal-middle（居中对话框） -->
      <div v-if="modelValue" class="modal modal-open modal-bottom backdrop-blur-[2px] md:modal-middle md:p-4" :class="z">
        <!-- 面板 -->
        <div
          class="modal-box modal-panel relative flex max-h-[85svh] w-full flex-col overflow-hidden border border-line p-0 shadow-xl"
          :class="[width, dragY && '!transition-none']"
          :style="dragY ? { transform: `translateY(${dragY}px)` } : null"
          role="dialog"
          aria-modal="true"
        >
          <!-- 手机端把手 -->
          <div class="flex justify-center pt-2 md:hidden" @touchstart.passive="onDragStart" @touchmove.passive="onDragMove" @touchend="onDragEnd" @touchcancel="onDragEnd">
            <span class="h-1 w-9 rounded-full bg-base-content/20" />
          </div>
          <header class="flex items-center gap-2 px-4 pb-2 pt-1 md:pt-3" @touchstart.passive="onDragStart" @touchmove.passive="onDragMove" @touchend="onDragEnd" @touchcancel="onDragEnd">
            <h3 class="min-w-0 flex-1 truncate font-semibold">{{ title }}</h3>
            <button class="btn btn-sm btn-circle btn-ghost -mr-2" title="关闭" @click="close">
              <Icon name="x" class="h-5 w-5" />
            </button>
          </header>
          <div class="flex-1 overflow-y-auto px-4 py-3">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            class="modal-action safe-bottom mt-0 border-t border-line px-4 py-3"
          >
            <slot name="footer" />
          </footer>
        </div>
        <!-- 遮罩：点击关闭 -->
        <div class="modal-backdrop" @click="close" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--dur-in) var(--ease);
}
.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform var(--dur-in) var(--ease);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: translateY(32px);
}
</style>
