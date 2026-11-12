<script setup>
/**
 * 代理组卡片
 * - 标题栏：图标（配置里的 icon）、组名、类型、当前节点、节点数、整组测速、折叠
 * - 折叠时显示一排延迟色点，方便快速概览
 */
import { computed } from 'vue'
import { delayLevel, delayText, DELAY_BG_CLASS, DELAY_TEXT_CLASS } from '@/utils/format'
import Icon from '@/components/common/Icon.vue'
import ProxyNode from './ProxyNode.vue'
import ProxyIcon from './ProxyIcon.vue'

const props = defineProps({
  group: { type: Object, required: true }, // { name, type, now, all }
  proxies: { type: Object, required: true }, // 全部代理，用于查节点类型
  delays: { type: Object, required: true }, // { 节点名: 延迟 }
  testingNodes: { type: Object, required: true }, // { 节点名: true }
  testing: Boolean, // 整组测速中
  collapsed: Boolean,
  sort: { type: String, default: 'default' }, // default | delay | name
})
const emit = defineEmits(['select', 'test-group', 'test-node', 'toggle'])

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
</script>

<template>
  <section class="card overflow-hidden">
    <!-- 标题栏 -->
    <header
      class="flex cursor-pointer select-none items-center gap-3 px-4 py-3"
      @click="emit('toggle')"
    >
      <ProxyIcon v-if="group.icon" :icon="group.icon" :size="44" />
      <div class="min-w-0 flex-1">
        <!-- 第一行：组名 + 淡色的类型与节点数 -->
        <div class="flex items-baseline gap-2">
          <h3 class="max-w-full shrink-0 truncate font-semibold">{{ group.name }}</h3>
          <span class="min-w-0 truncate text-xs text-slate-400 dark:text-slate-500">{{ group.type }} · {{ group.all?.length || 0 }}</span>
          <!-- 右上角：当前节点延迟 -->
          <span v-if="nowDelay !== undefined" class="ml-auto shrink-0 text-xs font-medium tabular-nums" :class="DELAY_TEXT_CLASS[delayLevel(nowDelay)]">
            {{ delayText(nowDelay) }}
          </span>
        </div>
        <!-- 第二行：当前节点 -->
        <div class="mt-0.5 flex items-center gap-2 text-sm">
          <span class="min-w-0 truncate text-slate-600 dark:text-slate-300" :title="group.now">{{ group.now || '--' }}</span>
        </div>
        <!-- 第三行（折叠时）：延迟色点 -->
        <div v-if="collapsed" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="n in nodes"
            :key="n.name"
            class="h-2 w-2 rounded-full"
            :class="[DELAY_BG_CLASS[delayLevel(n.delay)], n.name === group.now && 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900']"
            :title="n.name"
          />
        </div>
      </div>
      <button
        class="btn-icon"
        :disabled="testing"
        title="整组测速"
        @click.stop="emit('test-group')"
      >
        <Icon name="zap" class="h-[18px] w-[18px]" :class="testing && 'animate-pulse text-brand-500'" />
      </button>
      <Icon
        name="chevronDown"
        class="h-5 w-5 text-slate-400 transition-transform"
        :class="collapsed ? '' : 'rotate-180'"
      />
    </header>

    <!-- 展开：节点网格 -->
    <div
      v-if="!collapsed"
      class="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 dark:border-slate-800"
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
  </section>
</template>
