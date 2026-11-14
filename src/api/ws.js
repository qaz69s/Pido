/**
 * WebSocket 封装
 * - secret 通过 ?token= 传递（浏览器 WebSocket 无法设置请求头）
 * - 断线后指数退避自动重连：1s → 2s → 4s … 最长 15s
 * - 连续 3 次握手失败 → 状态置为 error（通常是 secret 错误或后端不可达）
 *
 * 状态：idle | connecting | open | reconnecting | error | closed
 */
import { getHttpConfig, isStandard } from './http'
import { createStandardStream } from './standard/streams'

/** http(s)://host:port/base + path → ws(s)://host:port/base/path?token=xxx */
export function buildWsUrl(path, query = {}, { baseUrl, secret } = getHttpConfig()) {
  const url = new URL(baseUrl + path)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  if (secret) url.searchParams.set('token', secret)
  return url.toString()
}

/**
 * 创建一个自动重连的数据流
 * @param {string} path 如 /traffic
 * @param {object} opts
 * @param {object|Function} [opts.query] 查询参数，传函数则每次连接时重新取值
 * @param {(data: any) => void} [opts.onMessage] 收到 JSON 消息
 * @param {(status: string) => void} [opts.onStatus] 状态变化
 * @returns {{ close: () => void }}
 */
export function createStream(path, { query, onMessage, onStatus, maxRetryDelay = 15000 } = {}) {
  // dae / honk（标准 API）没有 WebSocket，改用轮询 / SSE，消息形状保持一致
  if (isStandard()) return createStandardStream(path, { query, onMessage, onStatus })

  let ws = null
  let timer = null
  let retry = 0 // 当前重试次数（决定退避时长）
  let failCount = 0 // 连续“从未打开就关闭”的次数
  let stopped = false

  const setStatus = (s) => onStatus?.(s)

  function connect() {
    if (stopped) return
    const cfg = getHttpConfig()
    if (!cfg.baseUrl) {
      setStatus('idle')
      return
    }
    let url
    try {
      url = buildWsUrl(path, typeof query === 'function' ? query() : query, cfg)
    } catch {
      setStatus('error')
      return
    }

    setStatus(retry === 0 ? 'connecting' : 'reconnecting')
    try {
      ws = new WebSocket(url)
    } catch {
      // HTTPS 页面连接 ws:// 时浏览器会直接抛 SecurityError
      failCount++
      setStatus('error')
      schedule()
      return
    }

    let opened = false
    ws.onopen = () => {
      opened = true
      retry = 0
      failCount = 0
      setStatus('open')
    }
    ws.onmessage = (e) => {
      let data
      try {
        data = JSON.parse(e.data)
      } catch {
        return
      }
      onMessage?.(data)
    }
    ws.onerror = () => {
      /* 浏览器随后一定会触发 onclose，在那里统一处理 */
    }
    ws.onclose = () => {
      ws = null
      if (stopped) return
      if (!opened) failCount++
      setStatus(failCount >= 3 ? 'error' : 'reconnecting')
      schedule()
    }
  }

  function schedule() {
    clearTimeout(timer)
    const delay = Math.min(1000 * 2 ** retry, maxRetryDelay)
    retry++
    timer = setTimeout(connect, delay)
  }

  function close() {
    stopped = true
    clearTimeout(timer)
    if (ws) {
      // 先解绑事件，避免触发重连
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      ws.close()
      ws = null
    }
    setStatus('closed')
  }

  connect()
  return { close }
}
