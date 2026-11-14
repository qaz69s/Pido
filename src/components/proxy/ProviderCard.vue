<script setup>
/**
 * 代理集合（proxy-provider / 订阅）卡片，外观与代理组卡片保持一致
 * - 标题栏：名称、来源类型、节点数、更新时间；右侧图标按钮：更新订阅（云下载）、健康检查（心电图）、折叠
 * - 订阅流量条、可用数 / 平均延迟
 * - 折叠时显示迷你延迟柱；展开后列出订阅里的全部节点（只读，点延迟可单测）
 *   订阅节点不能直接选中，要在「代理组」里引用它的组中切换
 */
import { computed, ref, watch } from 'vue'
import { delayLevel, delayText, DELAY_BG_CLASS } from '@/utils/format'
import Icon from '@/components/common/Icon.vue'
import ProxyNode from './ProxyNode.vue'
import ExpandTransition from '@/components/common/ExpandTransition.vue'

const props = defineProps({
  provider: { type: Object, required: true },
  delays: { type: Object, required: true },
  testingNodes: { type: Object, required: true },
  busy: { type: String, default: '' }, // '' | 'update' | 'check'
  collapsed: Boolean,
  sort: { type: String, default: 'default' },
  subscription: { type: Object, default: null }, // { used, total, percent, expire }
  stats: { type: Object, required: true }, // { count, alive, avg }
  updatedText: { type: String, default: '' },
  /** 标准 API：显示「节点 / 管理节点」入口 */
  showManage: Boolean,
  canManage: Boolean,
})
const emit = defineEmits(['toggle', 'update', 'healthcheck', 'test-node', 'manage'])

const canUpdate = computed(() => props.provider._canUpdate !== false)
const canCheck = computed(() => props.provider._canHealthcheck !== false)

const nodes = computed(() => {
  const list = (props.provider.proxies || []).map((n) => ({
    name: n.name,
    type: n.type || '',
    delay: props.delays[n.name],
  }))
  if (props.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  else if (props.sort === 'delay') {
    const key = (d) => (d > 0 ? d : d === 0 ? 1e9 : 2e9)
    list.sort((a, b) => key(a.delay) - key(b.delay))
  }
  return list
})

// 首次展开后保留节点网格，之后 v-show 切换（同代理组卡片）
const rendered = ref(!props.collapsed)
watch(
  () => props.collapsed,
  (c) => {
    if (!c) rendered.value = true
  },
)

const maxDelay = computed(() => Math.max(300, ...nodes.value.map((n) => n.delay || 0)))
function barHeight(d) {
  if (d == null) return 20
  if (d === 0) return 100
  return Math.max(18, Math.min(100, (d / maxDelay.value) * 100))
}
</script>

<template>
  <section class="card overflow-hidden">
    <!-- 标题栏：点击展开 / 收起节点列表 -->
    <header class="flex cursor-pointer select-none items-center gap-2 px-4 py-3" @click="emit('toggle')">
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <h3 class="max-w-full shrink-0 truncate font-semibold">{{ provider.name }}</h3>
          <span class="min-w-0 truncate text-xs text-slate-400 dark:text-slate-500">{{ provider.vehicleType }} · {{ stats.count }}</span>
        </div>
        <div class="mt-0.5 truncate text-xs text-slate-500">
          可用 {{ stats.alive }} / {{ stats.count }}
          <template v-if="stats.avg">· 平均 {{ stats.avg }} ms</template>
          <template v-if="updatedText"> · 更新于 {{ updatedText }}</template>
        </div>
        <!-- 标准 API：订阅拉取失败时保留上次的节点，并给出原因 -->
        <div
          v-if="provider._lastError || provider._status === 'stale'"
          class="mt-1 truncate text-xs text-amber-600 dark:text-amber-400"
          :title="provider._lastError?.message || provider._lastError || ''"
        >
          {{ provider._lastError?.message || provider._lastError || '订阅未产出节点（stale）' }}
        </div>
      </div>

      <button v-if="showManage" class="btn-icon" :title="canManage ? '管理节点' : '查看节点'" @click.stop="emit('manage')">
        <Icon :name="canManage ? 'pencil' : 'list'" class="h-[17px] w-[17px]" />
      </button>
      <button v-if="canUpdate" class="btn-icon" :disabled="!!busy" title="更新订阅（重新拉取节点）" @click.stop="emit('update')">
        <Icon name="cloudDown" class="h-[18px] w-[18px]" :class="busy === 'update' && 'animate-pulse text-brand-500'" />
      </button>
      <button v-if="canCheck" class="btn-icon" :disabled="!!busy" title="健康检查（测试全部节点延迟）" @click.stop="emit('healthcheck')">
        <Icon name="activity" class="h-[18px] w-[18px]" :class="busy === 'check' && 'animate-pulse text-brand-500'" />
      </button>
      <Icon
        name="chevronDown"
        class="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300"
        :class="collapsed ? '' : 'rotate-180'"
      />
    </header>

    <!-- 订阅流量 -->
    <div v-if="subscription" class="-mt-1 px-4 pb-3 text-xs">
      <div class="mb-1 flex justify-between text-slate-500">
        <span>{{ subscription.used }} / {{ subscription.total }}</span>
        <span>到期 {{ subscription.expire }}</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-tile">
        <div
          class="h-full rounded-full"
          :class="subscription.percent > 90 ? 'bg-rose-500' : 'bg-brand-500'"
          :style="{ width: `${subscription.percent}%` }"
        />
      </div>
    </div>

    <!-- 折叠时：迷你延迟柱 -->
    <div v-if="collapsed && nodes.length" class="px-4 pb-3" :class="!subscription && '-mt-1'">
      <div class="flex h-4 items-end gap-[3px] overflow-hidden">
        <span
          v-for="(n, i) in nodes"
          :key="n.name"
          class="min-w-[2px] max-w-[5px] flex-1 rounded-sm opacity-80 transition-[height,background-color] duration-300"
          :class="[DELAY_BG_CLASS[delayLevel(n.delay)], busy === 'check' && 'anim-sweep']"
          :style="{ height: barHeight(n.delay) + '%', animationDelay: busy === 'check' ? `${(i % 30) * 45}ms` : null }"
          :title="`${n.name} · ${delayText(n.delay)}`"
        />
      </div>
    </div>

    <!-- 展开：订阅中的节点 -->
    <ExpandTransition fade-only>
      <div v-if="rendered" v-show="!collapsed" class="border-t border-slate-100 dark:border-slate-800">
        <div v-if="!nodes.length" class="p-4 text-center text-xs text-slate-500">
          这个集合还没有节点，点右上角的云图标更新一次试试
        </div>
        <div v-else class="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
          <ProxyNode
            v-for="n in nodes"
            :key="n.name"
            :name="n.name"
            :type="n.type"
            :delay="n.delay"
            :selectable="false"
            :testing="!!testingNodes[n.name] || busy === 'check'"
            @test="emit('test-node', n.name)"
          />
        </div>
      </div>
    </ExpandTransition>
  </section>
</template>
