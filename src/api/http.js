/**
 * HTTP 请求层
 * - 统一拼接后端地址、携带 Authorization: Bearer <secret>
 * - 超时控制
 * - 把各种失败归一成 ApiError（带 type），方便界面给出友好提示
 */

/** 统一错误类型 */
export class ApiError extends Error {
  /**
   * @param {'config'|'network'|'timeout'|'auth'|'http'|'mixed-content'|'aborted'} type
   * @param {string} message
   * @param {{status?: number, detail?: any}} [extra]
   */
  constructor(type, message, { status, detail } = {}) {
    super(message)
    this.name = 'ApiError'
    this.type = type
    this.status = status
    this.detail = detail
  }
}

// 运行时配置，由 stores/backend.js 写入（避免 api 层反向依赖 store）
const config = { baseUrl: '', secret: '' }
let unauthorizedHandler = null

export function configureHttp({ baseUrl, secret }) {
  config.baseUrl = baseUrl || ''
  config.secret = secret || ''
}

export function getHttpConfig() {
  return { ...config }
}

/** 注册全局 401 回调（secret 错误时通知 store） */
export function onUnauthorized(fn) {
  unauthorizedHandler = fn
}

/**
 * 规范化用户输入的后端地址
 *   "127.0.0.1:9090"  → "http://127.0.0.1:9090"
 *   "/mihomo"         → "http://localhost:5173/mihomo"（开发代理）
 *   去掉末尾斜杠
 */
export function normalizeBaseUrl(input) {
  let url = (input || '').trim()
  if (!url) return ''
  if (url.startsWith('/')) url = location.origin + url
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  return url.replace(/\/+$/, '')
}

function buildUrl(base, path, query) {
  const url = new URL(base + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/** HTTPS 页面请求 HTTP 地址会被浏览器拦截（localhost/127.0.0.1 除外） */
function isMixedContent(base) {
  return (
    location.protocol === 'https:' &&
    base.startsWith('http:') &&
    !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(base)
  )
}

async function parseBody(res) {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 发送请求
 * @param {string} path  以 / 开头的接口路径，如 /proxies
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.query]   查询参数
 * @param {any}    [opts.body]    JSON 请求体
 * @param {number} [opts.timeout] 超时毫秒，默认 10s
 * @param {string} [opts.baseUrl] 覆盖全局后端地址（用于“测试连接”）
 * @param {string} [opts.secret]  覆盖全局 secret
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.skipAuthHandler] 401 时不触发全局回调
 */
export async function request(path, opts = {}) {
  const {
    method = 'GET',
    query,
    body,
    timeout = 10000,
    signal,
    skipAuthHandler = false,
  } = opts
  const base = opts.baseUrl ?? config.baseUrl
  const token = opts.secret ?? config.secret

  if (!base) throw new ApiError('config', '尚未配置后端地址')
  if (isMixedContent(base)) {
    throw new ApiError('mixed-content', 'HTTPS 页面无法访问 HTTP 后端')
  }

  // 超时控制
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(buildUrl(base, path, query), {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    })
  } catch (err) {
    if (timedOut) throw new ApiError('timeout', `请求超时（${Math.round(timeout / 1000)} 秒）`)
    if (signal?.aborted) throw new ApiError('aborted', '请求已取消')
    // fetch 抛 TypeError：后端不可达、CORS 拦截、证书错误等，浏览器不会告诉我们具体原因
    throw new ApiError('network', '无法连接到后端', { detail: err?.message })
  } finally {
    clearTimeout(timer)
  }

  const data = await parseBody(res)
  if (res.ok) return data

  if (res.status === 401) {
    const e = new ApiError('auth', 'Secret 错误或缺失', { status: 401 })
    if (!skipAuthHandler) unauthorizedHandler?.(e)
    throw e
  }
  const msg =
    (data && typeof data === 'object' && data.message) ||
    (typeof data === 'string' && data) ||
    res.statusText
  throw new ApiError('http', `${res.status} ${msg}`.trim(), { status: res.status, detail: data })
}

/** 便捷方法 */
export const http = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
}

/**
 * 把错误转换成界面上的标题 + 排查建议
 * @returns {{title: string, tips: string[]}}
 */
export function describeError(err) {
  if (!(err instanceof ApiError)) {
    return { title: err?.message || String(err) || '未知错误', tips: [] }
  }
  switch (err.type) {
    case 'network':
      return {
        title: '无法连接到后端',
        tips: [
          '确认 mihomo 正在运行，并在配置中开启了 external-controller（如 127.0.0.1:9090）',
          '检查地址和端口；手机访问时不能填 127.0.0.1，要填电脑的局域网 IP，且 external-controller 需监听 0.0.0.0',
          '地址正确仍失败，多半是被 CORS 拦截：在配置中设置 external-controller-cors 允许当前来源；本地开发可改用 Vite 代理',
        ],
      }
    case 'timeout':
      return {
        title: err.message,
        tips: ['后端响应太慢或网络不通，检查防火墙和端口是否放行'],
      }
    case 'auth':
      return {
        title: 'Secret 错误',
        tips: ['与 mihomo 配置文件中的 secret 字段保持一致', '后端未设置 secret 时请留空'],
      }
    case 'mixed-content':
      return {
        title: 'HTTPS 页面无法访问 HTTP 后端',
        tips: [
          '用 http:// 打开本面板，或把面板放进 mihomo 的 external-ui，通过 http://后端地址/ui/ 访问',
          '或为后端配置 TLS（external-controller-tls），改用 https:// 地址',
        ],
      }
    case 'config':
      return { title: err.message, tips: [] }
    default:
      return { title: err.message, tips: [] }
  }
}

/** 一行简短的错误文字，用于 Toast */
export function errorMessage(err) {
  return describeError(err).title
}
