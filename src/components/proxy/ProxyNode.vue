<script setup>
/**
 * 单个节点卡片
 * - 点击卡片：切换到该节点（仅 Selector 组可切换）
 * - 点击延迟：单独测该节点延迟
 * - 动画：被选中时弹一下（.anim-select），延迟更新时数字轻闪（.anim-pop），按下轻微缩小
 */
import { computed } from 'vue'
import { delayLevel, delayText, DELAY_TEXT_CLASS } from '@/utils/format'
import ProxyIcon from './ProxyIcon.vue'

const props = defineProps({
  name: { type: String, required: true },
  type: { type: String, default: '' },
  icon: { type: String, default: '' }, // 成员是策略组时的图标
  delay: { type: Number, default: undefined },
  active: Boolean,
  selectable: Boolean,
  testing: Boolean,
})
const emit = defineEmits(['select', 'test'])

const delayClass = computed(() => DELAY_TEXT_CLASS[delayLevel(props.delay)])

function onSelect() {
  if (props.selectable && !props.active) emit('select')
}
</script>

<template>
  <div
    role="button"
    :tabindex="selectable ? 0 : -1"
    class="flex min-w-0 flex-col gap-1 rounded-xl border p-2.5 text-left transition duration-200"
    :class="[
      active
        ? 'anim-select border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-500/10'
        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      selectable && !active ? 'press cursor-pointer hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-600' : '',
      !selectable ? 'cursor-default' : '',
    ]"
    @click="onSelect"
    @keydown.enter="onSelect"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <ProxyIcon v-if="icon" :icon="icon" :size="16" />
      <span class="truncate text-sm font-medium" :title="name">{{ name }}</span>
    </span>
    <div class="flex items-center justify-between gap-2 text-xs">
      <span class="truncate text-slate-400">{{ type }}</span>
      <button
        type="button"
        class="shrink-0 rounded px-1 tabular-nums font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
        :class="delayClass"
        :disabled="testing"
        title="测试延迟"
        @click.stop="emit('test')"
      >
        <span v-if="testing" class="inline-block animate-pulse">测速中</span>
        <span v-else :key="delayText(delay)" class="anim-pop">{{ delayText(delay) }}</span>
      </button>
    </div>
  </div>
</template>
