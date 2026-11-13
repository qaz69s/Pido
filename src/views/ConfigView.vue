<script setup>
/**
 * 配置页
 * - 运行模式、日志级别、入站端口、局域网 / IPv6、TUN 等：PATCH /configs（只改运行时，重启内核后恢复为配置文件的值）
 * - 维护操作：重载配置、更新 GEO 数据库、清空 FakeIP / DNS 缓存、重启内核
 * - 更新：在线更新面板、升级内核（Release / Alpha，见 UpdateSection.vue）
 * - 面板设置：主题、当前后端、更换 / 断开后端
 */
import { computed, reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  getConfigs,
  patchConfigs,
  reloadConfigs,
  updateGeoDatabase,
  flushFakeIpCache,
  flushDnsCache,
  restartCore,
} from '@/api/configs'
import { describeError, errorMessage } from '@/api/http'
import { useBackendStore } from '@/stores/backend'
import { useThemeStore } from '@/stores/theme'
import { useMotionStore } from '@/stores/motion'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import EmptyState from '@/components/common/EmptyState.vue'
import Icon from '@/components/common/Icon.vue'
import Switch from '@/components/common/Switch.vue'
import SettingRow from '@/components/common/SettingRow.vue'
import UpdateSection from '@/components/config/UpdateSection.vue'
import { THEME_PRESETS } from '@/utils/themes'

const router = useRouter()
const backend = useBackendStore()
const theme = useThemeStore()
const motion = useMotionStore()
const toast = useToastStore()
const confirm = useConfirmStore()

/* ---------- 加载 ---------- */
const cfg = ref(null)
const loading = ref(true)
const loadError = ref(null)

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    cfg.value = await getConfigs()
    resetPorts()
    loadError.value = null
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 正在保存的字段，用于按钮 / 开关的 loading 状态 */
const saving = reactive({})

/**
 * 提交局部修改并重新读取配置
 * @param {string} key     saving 中的标记名
 * @param {object} partial PATCH 的内容
 * @param {string} okText  成功提示
 */
async function apply(key, partial, okText) {
  saving[key] = true
  try {
    await patchConfigs(partial)
    await load({ silent: true })
    if (okText) toast.success(okText)
    return true
  } catch (e) {
    toast.error(`修改失败：${errorMessage(e)}`)
    return false
  } finally {
    delete saving[key]
  }
}

/* ---------- 运行模式 ---------- */
const MODES = [
  { value: 'rule', label: '规则', desc: '按规则分流', icon: 'list' },
  { value: 'global', label: '全局', desc: '全部走代理', icon: 'globe' },
  { value: 'direct', label: '直连', desc: '全部不走代理', icon: 'arrowDownToLine' },
]
const mode = computed(() => (cfg.value?.mode || '').toLowerCase())
function setMode(m) {
  if (m === mode.value || saving.mode) return
  const label = MODES.find((x) => x.value === m)?.label
  apply('mode', { mode: m }, `已切换为${label}模式`)
}

/* ---------- 日志级别 ---------- */
const LOG_LEVELS = [
  { value: 'debug', label: '调试 debug' },
  { value: 'info', label: '信息 info' },
  { value: 'warning', label: '警告 warning' },
  { value: 'error', label: '错误 error' },
  { value: 'silent', label: '静默 silent' },
]
function setLogLevel(e) {
  apply('log-level', { 'log-level': e.target.value }, '日志级别已修改')
}

/* ---------- 端口 ---------- */
const PORTS = [
  { key: 'mixed-port', label: '混合端口', desc: 'HTTP + SOCKS5' },
  { key: 'port', label: 'HTTP 端口' },
  { key: 'socks-port', label: 'SOCKS5 端口' },
  { key: 'redir-port', label: 'Redir 端口', desc: '透明代理（Linux / macOS）' },
  { key: 'tproxy-port', label: 'TProxy 端口', desc: '透明代理（Linux）' },
]
const ports = reactive({})
function resetPorts() {
  for (const p of PORTS) ports[p.key] = cfg.value?.[p.key] ?? 0
}

/** 校验：0 表示关闭，其余必须是 1–65535 的整数，且不能重复 */
const portErrors = computed(() => {
  const errs = {}
  const used = {}
  for (const p of PORTS) {
    const v = Number(ports[p.key])
    if (!Number.isInteger(v) || v < 0 || v > 65535) errs[p.key] = '0–65535'
    else if (v > 0 && used[v]) errs[p.key] = `与${used[v]}重复`
    if (v > 0) used[v] = p.label
  }
  return errs
})
const portsDirty = computed(() => PORTS.some((p) => Number(ports[p.key]) !== (cfg.value?.[p.key] ?? 0)))

function savePorts() {
  if (Object.keys(portErrors.value).length) return
  const changed = {}
  for (const p of PORTS) {
    const v = Number(ports[p.key])
    if (v !== (cfg.value?.[p.key] ?? 0)) changed[p.key] = v
  }
  apply('ports', changed, '端口已修改')
}

/* ---------- 开关类 ---------- */
async function toggle(key, value, okText) {
  const ok = await apply(key, { [key]: value }, null)
  if (!ok) return
  // 有些选项依赖配置文件里的其它段落（如域名嗅探需要 sniffer 配置），后端会接受请求但不生效
  if (!!cfg.value?.[key] !== value) {
    toast.warning('内核没有应用这项修改，可能需要先在配置文件中添加相关配置', { timeout: 5000 })
  } else {
    toast.success(okText)
  }
}

/* ---------- TUN ---------- */
/**
 * TUN 网络栈（值与 mihomo 返回的大小写一致）
 * Mips 为 mihomo 自研 IP 协议栈，新版本内核的默认值；旧内核不认识时会保持原来的栈
 */
const TUN_STACKS = ['Mips', 'System', 'gVisor', 'Mixed']
/** 下拉框选项：当前内核返回了列表外的值时也显示出来，避免显示错位 */
const tunStackOptions = computed(() => {
  const cur = tun.value.stack
  return cur && !TUN_STACKS.some((s) => s.toLowerCase() === String(cur).toLowerCase()) ? [...TUN_STACKS, cur] : TUN_STACKS
})
const tun = computed(() => cfg.value?.tun || {})

async function setTun(partial, okText) {
  const wantEnable = partial.enable
  const ok = await apply('tun', { tun: partial }, null)
  if (!ok) return
  // 开启 TUN 需要管理员 / root 权限，失败时后端不会报错，只是状态没变
  if (wantEnable === true && !cfg.value?.tun?.enable) {
    toast.warning('TUN 未能开启：通常需要以管理员 / root 权限运行 mihomo，详情见日志页', { timeout: 6000 })
  } else if (partial.stack && String(cfg.value?.tun?.stack || '').toLowerCase() !== partial.stack.toLowerCase()) {
    // 旧内核不认识新的网络栈（如 Mips）时不会报错，只是保持原值
    toast.warning(`当前内核不支持 ${partial.stack} 网络栈，请先升级 mihomo`, { timeout: 6000 })
  } else {
    toast.success(okText)
  }
}

/* ---------- 维护操作 ---------- */
const ACTIONS = [
  {
    key: 'reload',
    label: '重载配置文件',
    desc: '重新读取磁盘上的配置，本页的临时修改会被覆盖',
    icon: 'file',
    run: () => reloadConfigs(),
    ok: '配置已重载',
    confirm: { title: '重新加载配置文件？', message: '本页所做的临时修改会被配置文件中的值覆盖，现有连接可能中断。' },
  },
  {
    key: 'geo',
    label: '更新 GEO 数据库',
    desc: '下载最新的 GeoIP / GeoSite，需要一些时间',
    icon: 'database',
    run: () => updateGeoDatabase(),
    ok: 'GEO 数据库已更新',
  },
  {
    key: 'fakeip',
    label: '清空 FakeIP 缓存',
    desc: '域名映射异常时使用',
    icon: 'trash',
    run: () => flushFakeIpCache(),
    ok: 'FakeIP 缓存已清空',
  },
  {
    key: 'dns',
    label: '清空 DNS 缓存',
    desc: '较新的内核支持',
    icon: 'trash',
    run: () => flushDnsCache(),
    ok: 'DNS 缓存已清空',
  },
  {
    key: 'restart',
    label: '重启内核',
    desc: '所有连接会短暂中断',
    icon: 'power',
    danger: true,
    run: () => restartCore(),
    ok: '内核正在重启…',
    confirm: { title: '重启 mihomo 内核？', message: '所有连接会中断，几秒后自动恢复。', danger: true, confirmText: '重启' },
  },
]

async function runAction(a) {
  if (a.confirm && !(await confirm.ask(a.confirm))) return
  saving[a.key] = true
  try {
    await a.run()
    toast.success(a.ok)
    if (a.key === 'restart') {
      // 等内核起来后重新检测连接
      setTimeout(async () => {
        await backend.check()
        load({ silent: true })
      }, 3000)
    } else if (a.key === 'reload') {
      load({ silent: true })
    }
  } catch (e) {
    if (e.status === 404) toast.warning(`当前内核不支持「${a.label}」`)
    else toast.error(`${a.label}失败：${errorMessage(e)}`)
  } finally {
    delete saving[a.key]
  }
}

/* ---------- 面板设置 ---------- */
const THEMES = [
  { value: 'system', label: '跟随系统', icon: 'monitor' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
]

async function disconnect() {
  const ok = await confirm.ask({
    title: '断开当前后端？',
    message: '会清除本机保存的后端地址和 secret，之后需要重新填写。',
    confirmText: '断开',
    danger: true,
  })
  if (!ok) return
  backend.clear()
  router.replace('/setup')
}

const loadErrorInfo = computed(() => (loadError.value ? describeError(loadError.value) : null))
</script>

<template>
  <div class="space-y-4">
    <!-- 加载中 -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card h-32 animate-pulse" />
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadErrorInfo" class="card">
      <EmptyState icon="alert" :title="loadErrorInfo.title" :tips="loadErrorInfo.tips">
        <button class="btn-primary" @click="load()">重试</button>
        <RouterLink to="/setup" class="btn-outline">修改设置</RouterLink>
      </EmptyState>
    </div>

    <template v-else-if="cfg">
      <p class="flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
        这里的修改立即生效，但只作用于当前运行的内核；重启或重载配置后会恢复为配置文件中的值。
      </p>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- 左列 -->
        <div class="space-y-4">
          <!-- 运行模式 -->
          <section class="card p-4">
            <h2 class="mb-3 font-semibold">运行模式</h2>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="m in MODES"
                :key="m.value"
                class="flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition"
                :class="
                  mode === m.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-transparent bg-tile hover:brightness-95 dark:hover:brightness-110'
                "
                :disabled="saving.mode"
                @click="setMode(m.value)"
              >
                <Icon :name="m.icon" class="h-5 w-5" />
                <span class="text-sm font-medium">{{ m.label }}</span>
                <span class="text-xs text-slate-500">{{ m.desc }}</span>
              </button>
            </div>
          </section>

          <!-- 入站端口 -->
          <section class="card">
            <div class="flex items-center gap-2 px-4 pt-4">
              <h2 class="flex-1 font-semibold">入站端口</h2>
              <button v-if="portsDirty" class="btn-ghost py-1 text-xs" @click="resetPorts">还原</button>
              <button
                class="btn-primary py-1 text-xs"
                :disabled="!portsDirty || !!Object.keys(portErrors).length || saving.ports"
                @click="savePorts"
              >
                {{ saving.ports ? '保存中…' : '保存' }}
              </button>
            </div>
            <p class="px-4 pt-1 text-xs text-slate-500">填 0 表示关闭该端口</p>
            <div class="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
              <div v-for="p in PORTS" :key="p.key">
                <label class="label text-xs" :title="p.desc">{{ p.label }}</label>
                <input
                  v-model.number="ports[p.key]"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max="65535"
                  class="input py-1.5 tabular-nums"
                  :class="portErrors[p.key] && '!border-rose-500 focus:!ring-rose-500/20'"
                />
                <p v-if="portErrors[p.key]" class="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{{ portErrors[p.key] }}</p>
              </div>
            </div>
          </section>

          <!-- 网络 -->
          <section class="card divide-y divide-slate-100 dark:divide-slate-800">
            <h2 class="px-4 pb-2 pt-4 font-semibold">网络</h2>
            <SettingRow title="允许局域网连接" description="其他设备可通过本机 IP 使用代理端口">
              <Switch
                :model-value="!!cfg['allow-lan']"
                :loading="!!saving['allow-lan']"
                @update:model-value="(v) => toggle('allow-lan', v, v ? '已允许局域网连接' : '已关闭局域网连接')"
              />
            </SettingRow>
            <SettingRow title="IPv6" description="关闭后不解析 AAAA 记录">
              <Switch
                :model-value="!!cfg.ipv6"
                :loading="!!saving.ipv6"
                @update:model-value="(v) => toggle('ipv6', v, v ? '已开启 IPv6' : '已关闭 IPv6')"
              />
            </SettingRow>
            <SettingRow title="域名嗅探" description="从 TLS / HTTP 流量中识别域名">
              <Switch
                :model-value="!!cfg.sniffing"
                :loading="!!saving.sniffing"
                @update:model-value="(v) => toggle('sniffing', v, v ? '已开启域名嗅探' : '已关闭域名嗅探')"
              />
            </SettingRow>
            <SettingRow title="TCP 并发" description="同时连接解析出的多个 IP，取最快的">
              <Switch
                :model-value="!!cfg['tcp-concurrent']"
                :loading="!!saving['tcp-concurrent']"
                @update:model-value="(v) => toggle('tcp-concurrent', v, v ? '已开启 TCP 并发' : '已关闭 TCP 并发')"
              />
            </SettingRow>
            <SettingRow title="日志级别" description="内核输出日志的最低级别">
              <select
                class="input w-auto py-1.5"
                :value="cfg['log-level']"
                :disabled="!!saving['log-level']"
                @change="setLogLevel"
              >
                <option v-for="l in LOG_LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
              </select>
            </SettingRow>
          </section>
        </div>

        <!-- 右列 -->
        <div class="space-y-4">
          <!-- TUN -->
          <section class="card divide-y divide-slate-100 dark:divide-slate-800">
            <div class="flex items-center gap-2 px-4 pb-2 pt-4">
              <h2 class="flex-1 font-semibold">TUN 模式</h2>
              <span
                class="chip"
                :class="tun.enable && '!bg-emerald-100 !text-emerald-700 dark:!bg-emerald-900/50 dark:!text-emerald-300'"
              >
                {{ tun.enable ? '运行中' : '未开启' }}
              </span>
            </div>
            <SettingRow title="启用 TUN" description="接管系统全部流量，需要管理员 / root 权限">
              <Switch
                :model-value="!!tun.enable"
                :loading="!!saving.tun"
                @update:model-value="(v) => setTun({ enable: v }, v ? 'TUN 已开启' : 'TUN 已关闭')"
              />
            </SettingRow>
            <SettingRow title="网络栈" description="Mips 为 mihomo 自研栈（推荐）；System 占用低；gVisor 隔离性好；Mixed 兼顾">
              <select
                class="input w-auto py-1.5"
                :value="tun.stack"
                :disabled="!!saving.tun"
                @change="(e) => setTun({ stack: e.target.value }, `网络栈已切换为 ${e.target.value}`)"
              >
                <option v-for="s in tunStackOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </SettingRow>
            <SettingRow title="自动路由" description="auto-route，自动设置系统路由表">
              <Switch
                :model-value="!!tun['auto-route']"
                :loading="!!saving.tun"
                @update:model-value="(v) => setTun({ 'auto-route': v }, v ? '已开启自动路由' : '已关闭自动路由')"
              />
            </SettingRow>
            <SettingRow title="自动检测出口网卡" description="auto-detect-interface，防止回环">
              <Switch
                :model-value="!!tun['auto-detect-interface']"
                :loading="!!saving.tun"
                @update:model-value="(v) => setTun({ 'auto-detect-interface': v }, v ? '已开启自动检测网卡' : '已关闭自动检测网卡')"
              />
            </SettingRow>
            <div v-if="tun.device || tun['dns-hijack']?.length" class="space-y-1 px-4 py-3 text-xs text-slate-500">
              <div v-if="tun.device">设备名：<span class="font-mono">{{ tun.device }}</span></div>
              <div v-if="tun['dns-hijack']?.length">
                DNS 劫持：<span class="font-mono">{{ tun['dns-hijack'].join(', ') }}</span>
              </div>
            </div>
          </section>

          <!-- 维护 -->
          <section class="card divide-y divide-slate-100 dark:divide-slate-800">
            <h2 class="px-4 pb-2 pt-4 font-semibold">维护</h2>
            <SettingRow v-for="a in ACTIONS" :key="a.key" :title="a.label" :description="a.desc">
              <button
                :class="a.danger ? 'btn-danger' : 'btn-outline'"
                class="py-1 text-xs"
                :disabled="!!saving[a.key]"
                @click="runAction(a)"
              >
                <Icon :name="a.icon" class="h-3.5 w-3.5" :class="saving[a.key] && 'animate-pulse'" />
                {{ saving[a.key] ? '执行中…' : '执行' }}
              </button>
            </SettingRow>
          </section>

          <!-- 更新：面板 + 内核（Release / Alpha） -->
          <UpdateSection />

          <!-- 面板 -->
          <section class="card divide-y divide-slate-100 dark:divide-slate-800">
            <h2 class="px-4 pb-2 pt-4 font-semibold">面板</h2>
            <SettingRow title="外观">
              <div class="flex rounded-lg bg-tile p-0.5 text-xs dark:bg-page">
                <button
                  v-for="t in THEMES"
                  :key="t.value"
                  class="flex items-center gap-1 rounded-md px-2 py-1 transition"
                  :class="theme.mode === t.value ? 'bg-white font-medium shadow-sm dark:bg-tile' : 'text-slate-500'"
                  @click="theme.setMode(t.value, $event)"
                >
                  <Icon :name="t.icon" class="h-3.5 w-3.5" />
                  <span class="hidden sm:inline">{{ t.label }}</span>
                </button>
              </div>
            </SettingRow>
            <!-- 配色方案：色块预览 + 名称，点击立即生效 -->
            <div class="px-4 py-3">
              <div class="mb-2 text-sm font-medium">配色</div>
              <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <button
                  v-for="p in THEME_PRESETS"
                  :key="p.id"
                  class="group rounded-xl border p-2 text-left transition"
                  :class="
                    theme.preset === p.id
                      ? 'border-brand-500 ring-2 ring-brand-500/25'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                  "
                  :title="p.desc"
                  @click="theme.setPreset(p.id, $event)"
                >
                  <div class="flex h-7 overflow-hidden rounded-md">
                    <span class="flex-[2]" :style="{ background: p.swatch[0] }" />
                    <span class="flex-[2]" :style="{ background: p.swatch[1] }" />
                    <span class="flex-1" :style="{ background: p.swatch[2] }" />
                  </div>
                  <div class="mt-1.5 text-xs font-medium">{{ p.name }}</div>
                </button>
              </div>
            </div>
            <SettingRow title="动画效果" description="页面切换、展开、数字滚动等动画；系统开了「减少动画」时默认关闭">
              <Switch :model-value="motion.enabled" @update:model-value="motion.setEnabled" />
            </SettingRow>
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium">当前后端</div>
                <div class="mt-0.5 truncate font-mono text-xs text-slate-500">{{ backend.url }}</div>
                <div class="text-xs text-slate-500">
                  内核 {{ backend.version?.version || '--' }}{{ backend.version?.meta ? '（Meta）' : '' }}
                </div>
              </div>
              <RouterLink to="/setup" class="btn-outline py-1 text-xs">更换</RouterLink>
              <button class="btn-ghost py-1 text-xs text-rose-600 dark:text-rose-400" @click="disconnect">断开</button>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
