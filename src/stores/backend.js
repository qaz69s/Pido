/**
 * 后端连接配置
 * - 地址 + secret 保存在 localStorage
 * - save() 先用 GET /version 验证，通过后才保存
 * - check() 用于启动时 / 手动重试时检测连通性
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ApiError, configureHttp, normalizeBaseUrl, onUnauthorized } from '@/api/http'
import { getVersion } from '@/api/configs'
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

export const useBackendStore = defineStore('backend', () => {
  const saved = loadJSON('backend', null)

  const url = ref(saved?.url || '')
  const secret = ref(saved?.secret || '')
  /** unconfigured | unknown | checking | ok | error */
  const status = ref(saved?.url ? 'unknown' : 'unconfigured')
  /** @type {import('vue').Ref<{version: string, meta?: boolean} | null>} */
  const version = ref(null)
  /** @type {import('vue').Ref<ApiError | null>} */
  const lastError = ref(null)

  const isConfigured = computed(() => !!url.value)

  // 初始化 HTTP 层
  configureHttp({ baseUrl: url.value, secret: secret.value })

  // 任意请求返回 401 → 标记为异常，界面顶部会出现提示条
  onUnauthorized((err) => {
    status.value = 'error'
    lastError.value = err
  })

  /** 仅测试，不保存 */
  async function test(rawUrl, rawSecret) {
    const baseUrl = normalizeBaseUrl(rawUrl)
    if (!baseUrl) throw new ApiError('config', '请填写后端地址')
    const v = await getVersion({ baseUrl, secret: rawSecret, timeout: 6000, skipAuthHandler: true })
    return { baseUrl, version: v }
  }

  /** 测试通过后保存，返回版本信息 */
  async function save(rawUrl, rawSecret = '') {
    const { baseUrl, version: v } = await test(rawUrl, rawSecret)
    // 先更新 HTTP 配置，再改响应式状态 —— 这样监听 url/secret 的 WebSocket 重连时拿到的是新配置
    configureHttp({ baseUrl, secret: rawSecret })
    url.value = baseUrl
    secret.value = rawSecret
    saveJSON('backend', { url: baseUrl, secret: rawSecret })
    version.value = v
    status.value = 'ok'
    lastError.value = null
    return v
  }

  /** 检测当前配置是否可用 */
  async function check() {
    if (!url.value) return false
    status.value = 'checking'
    try {
      version.value = await getVersion({ timeout: 6000, skipAuthHandler: true })
      status.value = 'ok'
      lastError.value = null
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
    removeItem('backend')
    url.value = ''
    secret.value = ''
    version.value = null
    status.value = 'unconfigured'
    lastError.value = null
  }

  return { url, secret, status, version, lastError, isConfigured, test, save, check, clear }
})
