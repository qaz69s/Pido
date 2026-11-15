<script setup>
/**
 * 单个节点卡片
 * - 点击卡片：切换到该节点（仅 Selector 组可切换）
 * - 点击延迟：单独测该节点延迟
 * - 动画：被选中时弹一下（.anim-select），延迟更新时数字轻闪（.anim-pop），按下轻微缩小
 *   这两个动画只在挂载之后“变化”时才播放，展开网格时不会让几十个节点同时跑动画
 */
import { computed, ref, watch } from 'vue'
import { delayLevel, delayText, DELAY_TEXT_CLASS } from '@/utils/format'
import ProxyIcon from './ProxyIcon.vue'
import Num from '@/components/common/Num.vue'

const props = defineProps({
  name: { type: String, required: true },
  type: { type: String, default: '' },
  icon: { type: String, default: '' }, // 成员是策略组时的图标
  delay: { type: Number, default: undefined },
  active: Boolean,
  selectable: Boolean,
  testing: Boolean,
  /** false：只显示延迟，不能点击测速（dae / honk 由后端自动健康检查） */
  testable: { type: Boolean, default: true },
})
const emit = defineEmits(['select', 'test'])

/* 协议简写：卡片空间小（尤其系统字体放大时），长名字缩写，悬停 title 显示全称 */
const TYPE_SHORT = {
  Shadowsocks: 'SS',
  ShadowsocksR: 'SSR',
  Vmess: 'VMess',
  Vless: 'VLESS',
  Hysteria: 'HY',
  Hysteria2: 'HY2',
  WireGuard: 'WG',
  Tuic: 'TUIC',
  Socks5: 'SOCKS5',
  Http: 'HTTP',
  Ssh: 'SSH',
  Selector: '选择',
  URLTest: '自动',
  Fallback: '故障转移',
  LoadBalance: '负载均衡',
  Relay: '链式',
}
const typeLabel = computed(() => TYPE_SHORT[props.type] || props.type)

const delayClass = computed(() => DELAY_TEXT_CLASS[delayLevel(props.delay)])

/* 只在变化时触发动画：用自增 key 重新挂载数字/切换选中动画类 */
const popKey = ref(0)
const popping = ref(false)
watch(
  () => props.delay,
  () => {
    popKey.value++
    popping.value = true
  },
)
const bouncing = ref(false)
watch(
  () => props.active,
  (a) => {
    bouncing.value = a
  },
)

function onSelect() {
  if (props.selectable && !props.active) emit('select')
}
</script>

<template>
  <div
    role="button"
    :tabindex="selectable ? 0 : -1"
    class="relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-lg border p-2.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 [contain:layout_style]"
    :class="[
      active
        ? 'node-active border-primary bg-base-200 ring-1 ring-primary'
        : 'border-line bg-base-200',
      selectable && !active ? 'press cursor-pointer hover:border-line-strong hover:shadow-sm' : '',
      !selectable ? 'cursor-default' : '',
    ]"
    @animationend.self="bouncing = false"
    @click="onSelect"
    @keydown.enter="onSelect"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <ProxyIcon v-if="icon" :icon="icon" :size="16" />
      <span class="truncate text-sm" :class="active ? 'font-bold text-base-content' : 'font-semibold'" :title="name">{{ name }}</span>
    </span>
    <div class="flex items-center justify-between gap-2 text-sm">
      <span class="truncate text-base-content/70" :title="type">{{ typeLabel }}</span>
      <span v-if="!testable" class="shrink-0 px-1 tabular-nums" :class="delayClass">
        <Num :value="delayText(delay)" />
      </span>
      <button
        v-else
        type="button"
        class="shrink-0 rounded-md px-1 tabular-nums hover:bg-base-content/10"
        :class="delayClass"
        :disabled="testing"
        title="测试延迟"
        @click.stop="emit('test')"
      >
        <span v-if="testing" class="inline-block animate-pulse">测速中</span>
        <Num v-else :value="delayText(delay)" />
      </button>
    </div>
  </div>
</template>
