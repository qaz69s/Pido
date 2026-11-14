<script setup>
/**
 * 连接详情弹窗：展示 metadata 中所有有值的字段
 */
import { computed } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'
import { connChain, connRule, connTarget } from '@/utils/connection'

const props = defineProps({
  /** 当前查看的连接，null 表示关闭 */
  conn: { type: Object, default: null },
  /** 是否为已关闭的连接（已关闭的不显示“断开”按钮） */
  closed: { type: Boolean, default: false },
  now: { type: Number, default: () => Date.now() },
})
const emit = defineEmits(['close', 'disconnect'])

const open = computed({
  get: () => !!props.conn,
  set: (v) => !v && emit('close'),
})

/** metadata 字段的中文名，未列出的字段按原名显示 */
const LABELS = {
  network: '网络',
  type: '入站类型',
  inboundName: '入站名称',
  inboundUser: '入站用户',
  sourceIP: '来源 IP',
  sourcePort: '来源端口',
  inboundIP: '入站 IP',
  inboundPort: '入站端口',
  host: '域名',
  sniffHost: '嗅探域名',
  destinationIP: '目标 IP',
  destinationPort: '目标端口',
  remoteDestination: '远端地址',
  destinationIPASN: '目标 ASN',
  destinationGeoIP: '目标 GeoIP',
  sourceGeoIP: '来源 GeoIP',
  sourceIPASN: '来源 ASN',
  dnsMode: 'DNS 模式',
  process: '进程',
  processPath: '进程路径',
  uid: 'UID',
  specialProxy: '特殊代理',
  specialRules: '特殊规则',
  dscp: 'DSCP',
  // 标准 API（dae / honk）补充字段
  domainSource: '域名来源',
  observedBy: '统计来源',
  ruleSource: '规则来源',
}

/** 只保留有意义的字段（去掉空字符串、null、0 端口等） */
const metaRows = computed(() => {
  const m = props.conn?.metadata || {}
  return Object.entries(m)
    .filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length) && v !== 0)
    .map(([k, v]) => ({ key: k, label: LABELS[k] || k, value: Array.isArray(v) ? v.join(', ') : String(v) }))
})
</script>

<template>
  <Modal v-model="open" :title="conn ? connTarget(conn) : ''" width="md:max-w-xl">
    <template v-if="conn">
      <!-- 流量概要 -->
      <div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div class="rounded-lg bg-tile p-2">
          <div class="text-xs text-slate-500">下载</div>
          <div class="font-medium">{{ conn.download === null ? '--' : formatBytes(conn.download) }}</div>
        </div>
        <div class="rounded-lg bg-tile p-2">
          <div class="text-xs text-slate-500">上传</div>
          <div class="font-medium">{{ conn.upload === null ? '--' : formatBytes(conn.upload) }}</div>
        </div>
        <div class="rounded-lg bg-tile p-2">
          <div class="text-xs text-slate-500">速率 ↓/↑</div>
          <div class="truncate font-medium">{{ formatSpeed(conn.downSpeed || 0) }}</div>
          <div class="truncate text-xs text-slate-500">{{ formatSpeed(conn.upSpeed || 0) }}</div>
        </div>
        <div class="rounded-lg bg-tile p-2">
          <div class="text-xs text-slate-500">{{ closed ? '持续时长' : '已连接' }}</div>
          <div class="font-medium">{{ formatDuration(conn.start, closed ? conn.closedAt : now) }}</div>
        </div>
      </div>

      <!-- 规则与链路 -->
      <dl class="mb-3 space-y-2 text-sm">
        <div>
          <dt class="text-xs text-slate-500">命中规则</dt>
          <dd class="break-all font-mono">{{ connRule(conn) || '--' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">代理链路</dt>
          <dd class="flex flex-wrap items-center gap-1">
            <template v-for="(name, i) in connChain(conn)" :key="i">
              <span v-if="i" class="text-slate-400">→</span>
              <span class="chip text-xs">{{ name }}</span>
            </template>
          </dd>
        </div>
      </dl>

      <!-- 元数据 -->
      <dl class="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        <div v-for="r in metaRows" :key="r.key" class="flex gap-3 py-1.5">
          <dt class="w-24 shrink-0 text-slate-500">{{ r.label }}</dt>
          <dd class="min-w-0 flex-1 break-all font-mono text-[13px]">{{ r.value }}</dd>
        </div>
      </dl>
    </template>

    <template #footer>
      <button class="btn-outline" @click="emit('close')">关闭</button>
      <button v-if="!closed" class="btn-danger" @click="emit('disconnect', conn)">
        <Icon name="x" class="h-4 w-4" />
        断开连接
      </button>
    </template>
  </Modal>
</template>
