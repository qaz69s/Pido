<script setup>
/**
 * 纯文本代码编辑器（不依赖第三方库）
 * - textarea + 左侧行号栏，等宽字体，不自动换行；滚动时行号与高亮层同步
 * - marks：{ 行号: 'error' | 'warning' } —— 对应行整行标红 / 标黄，行号也变色
 * - Tab 键插入 4 个空格（dae 配置的习惯缩进）；只读时不拦截
 * - 对外暴露 jumpTo(line, column)：滚动到该行、选中该行（或从该列起），并聚焦
 * 行高与字号用固定像素（不随系统字体缩放），保证行号、高亮与文字严格对齐
 */
import { computed, ref } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  /** { [line: number]: 'error' | 'warning' } */
  marks: { type: Object, default: () => ({}) },
  /** 当前高亮（点击诊断跳转后的行） */
  focusLine: { type: Number, default: 0 },
})
const emit = defineEmits(['update:modelValue'])

const LH = 20 // 行高（px）
const PAD = 8 // 上下内边距（px）

const ta = ref(null)
const scrollTop = ref(0)

const lineCount = computed(() => {
  let n = 1
  const s = props.modelValue
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
})
/** 行号文本：一次性拼成一个字符串，几千行也很快 */
const gutterText = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1).join('\n'))
const gutterWidth = computed(() => `${String(lineCount.value).length + 2}ch`)

const markList = computed(() =>
  Object.entries(props.marks)
    .map(([line, level]) => ({ line: Number(line), level }))
    .filter((m) => m.line >= 1 && m.line <= lineCount.value),
)

function onScroll(e) {
  scrollTop.value = e.target.scrollTop
}

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

function onKeydown(e) {
  if (props.readonly || e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
  e.preventDefault()
  const el = ta.value
  el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end')
  emit('update:modelValue', el.value)
}

/** 跳到第 line 行（1 起），column 为 UTF-8 字节列（1 起），ASCII 内容下与字符列一致 */
function jumpTo(line, column) {
  const el = ta.value
  if (!el || !line) return
  const lines = props.modelValue.split('\n')
  const l = Math.min(Math.max(1, line), lines.length)
  let start = 0
  for (let i = 0; i < l - 1; i++) start += lines[i].length + 1
  const len = lines[l - 1].length
  const from = column ? start + Math.min(Math.max(0, column - 1), len) : start
  el.focus({ preventScroll: true })
  el.setSelectionRange(from, start + len)
  el.scrollTop = Math.max(0, (l - 1) * LH - el.clientHeight / 3)
  scrollTop.value = el.scrollTop
}

defineExpose({ jumpTo })
</script>

<template>
  <div
    class="code-editor relative flex overflow-hidden rounded-lg border border-slate-200 bg-tile font-mono dark:border-slate-700"
    :style="{ '--lh': `${LH}px`, '--pad': `${PAD}px` }"
  >
    <!-- 行号 -->
    <div
      class="code-line relative shrink-0 select-none border-r border-slate-200 text-right text-slate-400 dark:border-slate-700 dark:text-slate-500"
      :style="{ width: gutterWidth }"
      aria-hidden="true"
    >
      <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${-scrollTop}px)` }">
        <!-- 有标记的行号上色（不透明底色盖住下面的普通行号） -->
        <div
          v-for="m in markList"
          :key="'g' + m.line"
          class="code-line absolute inset-x-0 z-10 bg-tile"
          :style="{ top: `${PAD + (m.line - 1) * LH}px`, height: `${LH}px` }"
        >
          <div
            class="h-full font-semibold"
            :class="m.level === 'error' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'"
            style="padding-right: 0.75ch"
          >
            {{ m.line }}
          </div>
        </div>
        <pre class="code-text m-0 pr-[0.75ch]">{{ gutterText }}</pre>
      </div>
    </div>

    <!-- 编辑区 -->
    <div class="relative min-w-0 flex-1">
      <!-- 行高亮层（在文字下面） -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${-scrollTop}px)` }">
          <div
            v-for="m in markList"
            :key="'h' + m.line"
            class="absolute inset-x-0 border-l-2"
            :class="m.level === 'error' ? 'border-rose-500 bg-rose-500/15' : 'border-amber-500 bg-amber-500/15'"
            :style="{ top: `${PAD + (m.line - 1) * LH}px`, height: `${LH}px` }"
          />
          <div
            v-if="focusLine && focusLine <= lineCount"
            class="absolute inset-x-0 ring-1 ring-inset ring-brand-500/60"
            :style="{ top: `${PAD + (focusLine - 1) * LH}px`, height: `${LH}px` }"
          />
        </div>
      </div>
      <textarea
        ref="ta"
        class="code-text absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-3 text-slate-800 outline-none dark:text-slate-200"
        :class="readonly && 'cursor-default text-slate-600 dark:text-slate-400'"
        :value="modelValue"
        :readonly="readonly"
        wrap="off"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        aria-label="配置内容"
        @input="onInput"
        @scroll="onScroll"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.code-line {
  font-size: 13px;
  line-height: var(--lh);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono CJK SC', monospace;
}
.code-text {
  font-size: 13px;
  line-height: var(--lh);
  padding-top: var(--pad);
  padding-bottom: var(--pad);
  white-space: pre;
  tab-size: 4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono CJK SC', monospace;
}
</style>
