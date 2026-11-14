<script setup>
/**
 * 代理组卡片
 * - 标题栏：图标（配置里的 icon）、组名、类型、当前节点、节点数、组参数（仅标准 API 可调的组）、整组测速、折叠
 * - 折叠时显示一排延迟色点，方便快速概览
 * - 动画：展开/收起高度过渡；整组测速时色点依次亮起；延迟更新时数字轻闪
 */
import { computed, ref, watch } from 'vue'
import { delayLevel, delayText, DELAY_BG_CLASS, DELAY_TEXT_CLASS } from '@/utils/format'
import Icon from '@/components/common/Icon.vue'
import ProxyNode from './ProxyNode.vue'
import ProxyIcon from './ProxyIcon.vue'
import ExpandTransition from '@/components/common/ExpandTransition.vue'

const props = defineProps({
  group: { type: Object, required: true }, // { name, type, now, all }
  proxies: { type: Object, required: true }, // 全部代理，用于查节点类型
  delays: { type: Object, required: true }, // { 节点名: 延迟 }
  testingNodes: { type: Object, required: true }, // { 节点名: true }
  testing: Boolean, // 整组测速中
  collapsed: Boolean,
  sort: { type: String, default: 'default' }, // default | delay | name
  /** 标准 API：该组可调整检查间隔 / 容差，标题栏显示「组参数」按钮 */
  configurable: Boolean,
})
const emit = defineEmits(['select', 'test-group', 'test-node', 'toggle', 'settings'])

/** 当前节点的延迟（子策略组会跟随它自己的当前节点） */
const nowDelay = computed(() => (props.group.now ? props.delays[props.group.now] : undefined))

/** 只有 Selector（含 GLOBAL）允许手动切换 */
const selectable = computed(() => props.group.type === 'Selector')

const nodes = computed(() => {
  const list = (props.group.all || []).map((name) => ({
    name,
    type: props.proxies[name]?.type ?? '',
    icon: props.proxies[name]?.icon ?? '', // 成员本身是策略组时显示它的图标
    delay: props.delays[name],
  }))
  if (props.sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } else if (props.sort === 'delay') {
    // 有效延迟升序，超时和未测排最后
    const key = (d) => (d > 0 ? d : d === 0 ? 1e9 : 2e9)
    list.sort((a, b) => key(a.delay) - key(b.delay))
  }
  return list
})

/* ---------- 展开性能 ----------
 * 节点网格第一次展开后就保留在 DOM 里（之后用 v-show 切换），
 * 避免每次展开都重新创建几十上百个节点组件导致卡顿 */
const rendered = ref(!props.collapsed)
watch(
  () => props.collapsed,
  (c) => {
    if (!c) rendered.value = true
  },
)
// 一律只做淡入淡出 + 轻微位移，不做高度动画：高度动画每帧都要重新排版整页，用户真机（Android Chrome）上即使 10 个节点也掉帧
const LARGE = 0
const isLarge = computed(() => nodes.value.length > LARGE)
</script>

<template>
  <section class="card overflow-hidden">
    <!-- 标题栏 -->
    <header
      class="flex cursor-pointer select-none items-center gap-3 px-4 py-3"
      @click="emit('toggle')"
    >
      <ProxyIcon v-if="group.icon" :icon="group.icon" :size="40" />
      <div class="min-w-0 flex-1">
        <!-- 第一行：组名 + 淡色的类型与节点数 -->
        <div class="flex items-baseline gap-2">
          <h3 class="max-w-full shrink-0 truncate font-semibold">{{ group.name }}</h3>
          <span class="min-w-0 truncate text-xs text-slate-400 dark:text-slate-500">{{ group.type }} · {{ group.all?.length || 0 }}</span>
          <!-- 右上角：当前节点延迟 -->
          <span v-if="nowDelay !== undefined" class="ml-auto shrink-0 text-[13px] font-semibold tabular-nums" :class="DELAY_TEXT_CLASS[delayLevel(nowDelay)]">
            <span :key="delayText(nowDelay)" class="anim-pop">{{ delayText(nowDelay) }}</span>
          </span>
        </div>
        <!-- 第二行：当前节点 -->
        <div class="mt-0.5 flex items-center gap-2 text-sm">
          <span class="min-w-0 truncate text-slate-600 dark:text-slate-300" :title="group.now">{{ group.now || '--' }}</span>
        </div>
      </div>
      <button v-if="configurable" class="btn-icon hidden sm:inline-flex" title="组参数（检查间隔 / 容差）" @click.stop="emit('settings')">
        <Icon name="sliders" class="h-[17px] w-[17px]" />
      </button>
      <button
        class="btn-icon"
        :disabled="testing"
        title="整组测速"
        @click.stop="emit('test-group')"
      >
        <Icon name="zap" class="h-[18px] w-[18px]" :class="testing && 'anim-zap text-brand-500'" />
      </button>
      <Icon
        name="chevronDown"
        class="h-5 w-5 text-slate-400 transition-transform duration-300"
        :class="collapsed ? '' : 'rotate-180'"
      />
    </header>

    <!-- 折叠时：延迟色点，左侧与文字对齐（图标只占前两行，与展开时一致） -->
    <div v-if="collapsed" class="-mt-1 flex flex-wrap gap-1 pb-3 pr-4" :class="group.icon ? 'pl-[68px]' : 'pl-4'">
      <span
        v-for="(n, i) in nodes"
        :key="n.name"
        class="h-2 w-2 rounded-full transition-colors duration-300"
        :class="[DELAY_BG_CLASS[delayLevel(n.delay)], n.name === group.now && 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900', testing && 'anim-sweep']"
        :style="testing ? { animationDelay: `${(i % 30) * 45}ms` } : null"
        :title="n.name"
      />
    </div>

    <!-- 展开：节点网格（高度平滑拉开） -->
    <ExpandTransition :fade-only="isLarge">
      <div
        v-if="rendered"
        v-show="!collapsed"
        class="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3 dark:border-slate-800"
      >
        <ProxyNode
          v-for="n in nodes"
          :key="n.name"
          :name="n.name"
          :type="n.type"
          :icon="n.icon"
          :delay="n.delay"
          :active="n.name === group.now"
          :selectable="selectable"
          :testing="!!testingNodes[n.name] || testing"
          @select="emit('select', n.name)"
          @test="emit('test-node', n.name)"
        />
      </div>
    </ExpandTransition>

    <!-- 标准 API：组参数（展开时显示当前值；手机上标题栏放不下按钮，入口只在这里） -->
    <div
      v-if="configurable && !collapsed"
      class="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800"
    >
      <span class="min-w-0 flex-1 truncate">
        间隔 {{ group._config?.check_interval != null ? `${group._config.check_interval} 秒` : '默认' }}
        <template v-if="group._policy === 'urltest'"> · 容差 {{ group._config?.tolerance != null ? `${group._config.tolerance} ms` : '默认' }}</template>
      </span>
      <button class="btn-ghost shrink-0 px-2 py-0.5 text-xs" @click="emit('settings')">
        <Icon name="sliders" class="h-3.5 w-3.5" />
        调整
      </button>
    </div>
  </section>
</template>
