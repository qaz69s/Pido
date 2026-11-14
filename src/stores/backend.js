/**
 * 后端连接配置
 * - 地址 + secret + 后端类型保存在 localStorage
 * - 后端类型 kind：'mihomo'（Clash API）| 'standard'（dae ≥ 2.1.2 / honk 的 api-standardize 原生 API）
 *   连接时自动识别：GET {地址}/api 返回 discovery 文档即为标准 API，否则按 mihomo 处理
 * - save() 先验证（mihomo: GET /version；标准 API: GET /api/v1/version，带 Bearer），通过后才保存
 * - check() 用于启动时 / 手动重试时检测连通性
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ApiError, configureHttp, normalizeBaseUrl, onUnauthorized } from '@/api/http'
import { getVersion } from '@/api/configs'
import { detectBackend } from '@/api/detect'
import { getCapabilities, resetStandardCache } from '@/api/standard/client'
import { loadJSON, saveJSON, removeItem } from '@/utils/storage'

export const DEFAULT_URL = 'http://127.0.0.1:9090'
/** 与 vite.config.js 中 server.proxy 的前缀保持一致 */
export const DEV_PROXY_PATH = '/mihomo'

/** 推测默认地址：面板由 mihomo external-ui 提供（路径 /ui/）时，后端就是当前站点 */
export function guessDefaultUrl() {
  if (!import.meta.env.DEV && location.protocol.startsWith('http') && location.pathname.startsWith('/ui')) {
    return location.origin
  }
  return DEFAULT_URL
}

/**
 * 面板可能由 dae 自己托管（api { ui: '/目录' }，访问路径 …/ui/）；
 * 返回“托管它的后端”地址的候选：当前页面路径去掉 /ui 及之后的部分（兼容反向代理前缀）
 */
export function hostedBackendCandidate() {
  if (!location.protocol.startsWith('http')) return ''
  const m = location.pathname.match(/^(.*?)\/ui(\/|$)/)
  return location.origin + (m ? m[1] : '')
}

/** 引擎名的显示写法 */
const ENGINE_LABEL = { dae: 'dae', honk: 'honk' }

export const useBackendStore = defineStore('backend', () => {
  const saved = loadJSON('backend', null)

  const url = ref(saved?.url || '')
  const secret = ref(saved?.secret || '')
  /** 后端类型；旧版本保存的配置没有 kind，视为 mihomo */
  const kind = ref(saved?.kind === 'standard' ? 'standard' : 'mihomo')
  /** unconfigured | unknown | checking | ok | error */
  const status = ref(saved?.url ? 'unknown' : 'unconfigured')
  /**
   * mihomo：{ version: 'v1.19.x', meta?: boolean }
   * 标准 API：{ version: '2.1.2', engine: 'dae', kind: 'standard' }
   * @type {import('vue').Ref<object | null>}
   */
  const version = ref(null)
  /** 标准 API 的能力声明（GET /api/v1/capabilities），mihomo 为 null */
  const caps = ref(null)
  /** @type {import('vue').Ref<ApiError | null>} */
  const lastError = ref(null)

  const isConfigured = computed(() => !!url.value)
  const isStandard = computed(() => kind.value === 'standard')

  /** 引擎名：mihomo / dae / honk */
  const engine = computed(() => (isStandard.value ? version.value?.engine || 'dae' : 'mihomo'))

  /** 顶栏 / 设置页显示的版本：mihomo 只显示版本号（保持原样），标准 API 带上引擎名，如 "dae 2.1.2" */
  const label = computed(() => {
    const v = version.value?.version || ''
    if (!isStandard.value) return v
    const name = ENGINE_LABEL[version.value?.engine] || version.value?.engine || 'dae'
    return v ? `${name} ${v}` : name
  })

  /** 某项资源（标准 API capabilities.resources.xxx）是否可用；mihomo 一律 true */
  function supports(resource) {
    if (!isStandard.value) return true
    const r = caps.value?.resources?.[resource]
    if (!caps.value) return true // 能力信息还没读到时先按可用处理
    return !!r && r.available !== false
  }

  // 初始化 HTTP 层
  configureHttp({ baseUrl: url.value, secret: secret.value, kind: kind.value })

  // 任意请求返回 401 → 标记为异常，界面顶部会出现提示条
  onUnauthorized((err) => {
    status.value = 'error'
    lastError.value = err
  })

  /** 读取标准 API 的能力声明（失败不影响连接） */
  async function loadCaps() {
    if (!isStandard.value) {
      caps.value = null
      return
    }
    try {
      caps.value = await getCapabilities({ force: true })
    } catch {
      caps.value = null
    }
  }

  /** 仅测试，不保存；自动识别后端类型 */
  async function test(rawUrl, rawSecret) {
    const input = normalizeBaseUrl(rawUrl)
    if (!input) throw new ApiError('config', '请填写后端地址')
    const { kind: k, baseUrl } = await detectBackend(input)
    const v = await getVersion({ baseUrl, secret: rawSecret, timeout: 6000, skipAuthHandler: true, kind: k })
    return { baseUrl, version: v, kind: k }
  }

  /** 测试通过后保存，返回版本信息（附带 kind） */
  async function save(rawUrl, rawSecret = '') {
    const { baseUrl, version: v, kind: k } = await test(rawUrl, rawSecret)
    // 先更新 HTTP 配置，再改响应式状态 —— 这样监听 url/secret 的数据流重连时拿到的是新配置
    resetStandardCache()
    configureHttp({ baseUrl, secret: rawSecret, kind: k })
    kind.value = k
    url.value = baseUrl
    secret.value = rawSecret
    // mihomo 保持原来的存储格式；标准 API 额外记录 kind
    saveJSON('backend', k === 'standard' ? { url: baseUrl, secret: rawSecret, kind: k } : { url: baseUrl, secret: rawSecret })
    version.value = v
    status.value = 'ok'
    lastError.value = null
    await loadCaps()
    return { ...v, kind: k }
  }

  /** 检测当前配置是否可用 */
  async function check() {
    if (!url.value) return false
    status.value = 'checking'
    try {
      version.value = await getVersion({ timeout: 6000, skipAuthHandler: true })
      status.value = 'ok'
      lastError.value = null
      if (isStandard.value && !caps.value) loadCaps()
      return true
    } catch (e) {
      status.value = 'error'
      lastError.value = e
      return false
    }
  }

  /** 清除保存的配置 */
  function clear() {
    configureHttp({ baseUrl: '', secret: '' })
    resetStandardCache()
    removeItem('backend')
    url.value = ''
    secret.value = ''
    kind.value = 'mihomo'
    version.value = null
    caps.value = null
    status.value = 'unconfigured'
    lastError.value = null
  }

  return {
    url,
    secret,
    kind,
    status,
    version,
    caps,
    lastError,
    isConfigured,
    isStandard,
    engine,
    label,
    supports,
    test,
    save,
    check,
    clear,
  }
})
