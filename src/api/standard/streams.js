/**
 * 标准 API 的“数据流”：接口与 ws.js 的 createStream 相同，页面无需区分后端
 * 标准 API 没有 WebSocket：
 * - /traffic、/memory、/connections → 定时轮询 HTTP（推送的数据整理成 mihomo 的消息形状）
 * - /logs → SSE（GET /api/v1/logs，text/event-stream）。浏览器的 EventSource 无法携带
 *   Authorization 头，所以用 fetch 读取流并自行解析；断线带 Last-Event-ID 续传
 *
 * 状态：idle | connecting | open | reconnecting | error | closed | unsupported（后端没有此资源）
 */
import { getHttpConfig } from '../http'
import { API_BASE } from './client'
import { getRuntime, getTrafficHistory, trafficOf, getMemoryInuse, getConnectionsSnapshot } from './data'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 后端声明不支持该资源（404 capability_not_supported / resource 不存在） */
const isUnsupported = (e) => e?.status === 404 || e?.status === 405 || e?.code === 'capability_not_supported'

/**
 * 通用轮询器
 * @param {(emit: Function) => Promise<void>} tick 每次拉取并调用 emit
 * @param {number} interval 毫秒
 * @param {() => Promise<void>} [init] 首次连接前执行一次（如预填历史曲线），失败忽略
 */
function createPoller({ tick, interval, init, onStatus }) {
  let stopped = false
  let timer = null
  let fails = 0
  const setStatus = (s) => onStatus?.(s)

  async function loop() {
    if (stopped) return
    try {
      await tick()
      if (stopped) return
      fails = 0
      setStatus('open')
      timer = setTimeout(loop, interval)
    } catch (e) {
      if (stopped) return
      if (isUnsupported(e)) {
        setStatus('unsupported')
        return
      }
      fails++
      setStatus(fails >= 3 ? 'error' : 'reconnecting')
      timer = setTimeout(loop, Math.min(1000 * 2 ** (fails - 1), 15000))
    }
  }

  ;(async () => {
    if (!getHttpConfig().baseUrl) return setStatus('idle')
    setStatus('connecting')
    if (init) {
      try {
        await init()
      } catch {
        /* 预填失败不影响实时数据 */
      }
    }
    loop()
  })()

  return {
    close() {
      stopped = true
      clearTimeout(timer)
      setStatus('closed')
    },
  }
}

/* ---------------- SSE（日志） ---------------- */

/** mihomo 的日志级别 → 标准 API 的 LogLevel */
const LEVEL_TO_STD = { debug: 'debug', info: 'info', warning: 'warn', error: 'error', silent: 'error' }
/** 标准 API 的 LogLevel → 面板显示用的级别（与 mihomo 一致） */
const LEVEL_FROM_STD = { trace: 'debug', debug: 'debug', info: 'info', warn: 'warning', error: 'error' }

/** 把一条 LogRecord 整理成 mihomo 的 { type, payload }，附带后端时间 */
function mapLog(rec) {
  const fields = rec?.fields && typeof rec.fields === 'object'
    ? Object.entries(rec.fields)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ')
    : ''
  const head = rec?.target ? `[${rec.target}] ` : ''
  const t = Date.parse(rec?.ts)
  return {
    type: LEVEL_FROM_STD[rec?.level] || rec?.level || 'info',
    payload: `${head}${rec?.message ?? ''}${fields ? `  ${fields}` : ''}`,
    time: Number.isFinite(t) ? t : undefined,
  }
}

/**
 * 解析 SSE 文本：按空行分帧，返回 [{ id, event, data }]，剩余未完成部分留在 rest
 */
function parseFrames(text) {
  const frames = []
  const parts = text.split(/\r?\n\r?\n/)
  const rest = parts.pop() // 最后一段可能不完整
  for (const block of parts) {
    const f = { id: undefined, event: 'message', data: '' }
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue // 注释 / 心跳
      const i = line.indexOf(':')
      const field = i < 0 ? line : line.slice(0, i)
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'id') f.id = value
      else if (field === 'event') f.event = value
      else if (field === 'data') f.data += (f.data ? '\n' : '') + value
    }
    frames.push(f)
  }
  return { frames, rest }
}

function createLogStream({ query, onMessage, onStatus }) {
  let stopped = false
  let ctrl = null
  let cursor = null
  let fails = 0
  const setStatus = (s) => onStatus?.(s)

  async function connectOnce() {
    const { baseUrl, secret } = getHttpConfig()
    const q = (typeof query === 'function' ? query() : query) || {}
    const url = new URL(baseUrl + API_BASE + '/logs')
    const lv = LEVEL_TO_STD[q.level] || q.level
    if (lv) url.searchParams.set('level', lv)
    const headers = { Accept: 'text/event-stream' }
    if (secret) headers.Authorization = `Bearer ${secret}`
    if (cursor) headers['Last-Event-ID'] = cursor

    ctrl = new AbortController()
    // 心跳最长 15 秒一次；45 秒没有任何数据视为连接已死，重连
    let silence = null
    const alive = () => {
      clearTimeout(silence)
      silence = setTimeout(() => ctrl?.abort(), 45000)
    }
    alive()
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: ctrl.signal })
      if (res.status === 409) {
        // 续传游标过期：丢弃游标，重新建立基线
        cursor = null
        return 'retry-now'
      }
      if (res.status === 404) return 'unsupported'
      if (res.status === 401) return 'auth'
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        alive()
        buf += decoder.decode(value, { stream: true })
        const { frames, rest } = parseFrames(buf)
        buf = rest
        for (const f of frames) {
          if (f.id !== undefined) cursor = f.id
          if (f.event === 'stream.ready') {
            fails = 0
            setStatus('open')
          } else if (f.event === 'log' && f.data) {
            try {
              onMessage?.(mapLog(JSON.parse(f.data)))
            } catch {
              /* 单条解析失败忽略 */
            }
          }
        }
      }
      return 'ended'
    } finally {
      clearTimeout(silence)
    }
  }

  ;(async () => {
    if (!getHttpConfig().baseUrl) return setStatus('idle')
    setStatus('connecting')
    while (!stopped) {
      let r
      try {
        r = await connectOnce()
      } catch {
        r = 'failed'
      }
      if (stopped) break
      if (r === 'unsupported') return setStatus('unsupported')
      if (r === 'retry-now') continue
      fails++
      setStatus(r === 'auth' || fails >= 3 ? 'error' : 'reconnecting')
      await sleep(r === 'auth' ? 15000 : Math.min(1000 * 2 ** (fails - 1), 15000))
    }
  })()

  return {
    close() {
      stopped = true
      ctrl?.abort()
      setStatus('closed')
    },
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 与 ws.js 的 createStream 同签名
 * @param {string} path /traffic | /memory | /connections | /logs
 */
export function createStandardStream(path, { query, onMessage, onStatus } = {}) {
  const q = () => (typeof query === 'function' ? query() : query) || {}

  switch (path) {
    case '/traffic':
      // 实时速率：每秒读一次 /runtime（契约没有流量推送）；首次先用历史曲线把图表填满
      return createPoller({
        interval: 1000,
        onStatus,
        init: async () => {
          const samples = await getTrafficHistory({ windowSeconds: 60, maxPoints: 60 })
          for (const s of samples) onMessage?.({ up: s.up, down: s.down })
        },
        tick: async () => {
          const t = trafficOf(await getRuntime())
          onMessage?.({ up: t.up, down: t.down })
        },
      })
    case '/memory':
      return createPoller({
        interval: 2000,
        onStatus,
        tick: async () => {
          const inuse = await getMemoryInuse()
          onMessage?.({ inuse: inuse ?? 0 })
        },
      })
    case '/connections':
      return createPoller({
        interval: Math.max(1000, Number(q().interval) || 1000),
        onStatus,
        tick: async () => onMessage?.(await getConnectionsSnapshot()),
      })
    case '/logs':
      return createLogStream({ query, onMessage, onStatus })
    default:
      onStatus?.('unsupported')
      return { close() {} }
  }
}
