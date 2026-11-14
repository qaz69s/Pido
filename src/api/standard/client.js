/**
 * 标准 API（api-standardize，dae ≥ 2.1.2 / honk 实现）的基础工具
 * - 所有资源都在 {后端地址}/api/v1 下；认证同样是 Authorization: Bearer <secret>（由 http.js 统一处理）
 * - 64 位计数器以十进制字符串下发，这里统一转成 Number（显示用，精度足够）
 * - 异步操作（reload、probe、provider refresh）返回 202 + operation，需要轮询 /operations/{id}
 * - 组 / 节点在标准 API 里用 id 标识（dae 为 g_/n_ 加哈希），面板界面沿用 mihomo 的“按名称”约定，
 *   这里维护 id ↔ 名称 的映射表
 */
import { ApiError, http } from '../http'

export const API_BASE = '/api/v1'

/** 便捷方法：路径自动加 /api/v1 前缀 */
export const std = {
  get: (path, opts) => http.get(API_BASE + path, opts),
  post: (path, body, opts) => http.post(API_BASE + path, body, opts),
  put: (path, body, opts) => http.put(API_BASE + path, body, opts),
  patch: (path, body, opts) => http.patch(API_BASE + path, body, opts),
  del: (path, opts) => http.del(API_BASE + path, opts),
}

/** 十进制字符串 / 数字 → Number；null、空值、非法值 → null */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 判断一个对象是否是标准 API 的 discovery 文档（GET /api） */
export function isDiscovery(d) {
  return !!d && typeof d === 'object' && d.name === 'daeuniverse/native' && Number(d.api_major) === 1
}

/** 标准 API 错误体里的 details（如 403 的 details.reason、422 的 details.diagnostics） */
export function errorDetails(e) {
  const d = e?.detail
  return (d && typeof d === 'object' && d.error?.details) || null
}

/* ---------------- 能力（capabilities）缓存 ---------------- */

let capsCache = null
let capsPromise = null

/** GET /capabilities，结果缓存；后端变化时调用 resetStandardCache() */
export function getCapabilities({ force = false } = {}) {
  if (capsCache && !force) return Promise.resolve(capsCache)
  if (!capsPromise || force) {
    capsPromise = std
      .get('/capabilities')
      .then((c) => (capsCache = c))
      .finally(() => (capsPromise = null))
  }
  return capsPromise
}

/** 某项资源是否可用；读不到能力信息时视为可用（让请求自己失败，再由界面降级） */
export async function hasResource(name) {
  try {
    const c = await getCapabilities()
    const r = c?.resources?.[name]
    return r ? r.available !== false : false
  } catch {
    return true
  }
}

/* ---------------- id ↔ 名称 ---------------- */

/** { id: 名称 }，组和节点共用（dae 的 id 前缀 g_/n_ 不会冲突） */
const nameById = new Map()
/** { 名称: id } */
const idByName = new Map()
/** 名称 → 'group' | 'node' */
const kindByName = new Map()
let namesAt = 0

export function rememberName(id, name, kind) {
  if (!id) return
  const n = name || id
  nameById.set(id, n)
  idByName.set(n, id)
  if (kind) kindByName.set(n, kind)
}
export const nameOf = (id) => (id == null ? '' : nameById.get(id) ?? id)
export const idOf = (name) => idByName.get(name) ?? name
export const kindOf = (name) => kindByName.get(name)
export function markNamesFresh() {
  namesAt = Date.now()
}

/**
 * 确保 id → 名称映射可用（连接页的链路要显示名称）；30 秒内刷新过就不再请求
 * 只读组列表与节点列表，失败时静默（链路退回显示 id）
 */
export async function ensureNames() {
  if (Date.now() - namesAt < 30000) return
  namesAt = Date.now()
  try {
    const [groups, nodes] = await Promise.all([std.get('/groups'), listAllNodes()])
    for (const g of groupArray(groups)) rememberName(g.id, g.name, 'group')
    for (const n of nodes) rememberName(n.id, n.name, 'node')
  } catch {
    namesAt = 0
  }
}

/** /groups 的返回：契约为数组，个别实现可能包一层 { groups: [] } */
export function groupArray(d) {
  if (Array.isArray(d)) return d
  return d?.groups || d?.items || []
}

/** 分页读取全部节点（limit 上限 1000，cursor 绑定 generation） */
export async function listAllNodes(query = {}) {
  const out = []
  let cursor
  for (let i = 0; i < 50; i++) {
    const page = await std.get('/nodes', { query: { ...query, limit: 1000, cursor } })
    out.push(...(page?.nodes || []))
    cursor = page?.next_cursor
    if (!cursor) break
  }
  return out
}

/** 分页读取全部 providers */
export async function listAllProviders() {
  const out = []
  let cursor
  for (let i = 0; i < 20; i++) {
    const page = await std.get('/providers', { query: { limit: 1000, cursor } })
    out.push(...(page?.providers || []))
    cursor = page?.next_cursor
    if (!cursor) break
  }
  return out
}

/* ---------------- 异步操作 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 轮询一个已受理的操作直到结束
 * @param {{operation_id: string, href?: string}} accepted 202 的响应体
 * @param {{timeout?: number}} [opts] 最长等待毫秒，默认 60 秒
 * @returns {Promise<object>} 成功时的 operation（含 result）
 * 失败时抛出 ApiError，message 为后端给出的原因
 */
export async function waitOperation(accepted, { timeout = 60000 } = {}) {
  const id = accepted?.operation_id
  if (!id) return accepted // 有的实现可能直接返回结果（200）
  const deadline = Date.now() + timeout
  let delay = 600
  while (Date.now() < deadline) {
    await sleep(delay)
    let op
    try {
      op = await std.get(`/operations/${encodeURIComponent(id)}`, { timeout: 8000 })
    } catch (e) {
      // 限流 / 暂不可用：操作仍在进行，继续等
      if (e.status === 429 || e.status === 503) {
        delay = Math.min((e.retryAfter || 1) * 1000, 5000)
        continue
      }
      throw e
    }
    if (op?.status === 'succeeded') return op
    if (op?.status === 'failed') {
      const msg = op.error?.message || op.error?.code || '操作失败'
      const err = new ApiError('http', msg, { detail: op.error })
      err.backendKind = 'standard'
      throw err
    }
    delay = 1000
  }
  const err = new ApiError('timeout', '操作仍在进行，请稍后刷新查看结果')
  err.backendKind = 'standard'
  throw err
}

/**
 * 发起操作请求，遇到 429 / 503（附 Retry-After）时按建议的间隔重试几次
 * @param {() => Promise<any>} start 发起请求的函数
 */
export async function withRetry(start, { tries = 4 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await start()
    } catch (e) {
      if (i >= tries - 1 || !(e.status === 429 || e.status === 503)) throw e
      await sleep(Math.min((e.retryAfter || 1) * 1000, 8000))
    }
  }
}

/** 切换后端时清空缓存 */
export function resetStandardCache() {
  capsCache = null
  capsPromise = null
  nameById.clear()
  idByName.clear()
  kindByName.clear()
  namesAt = 0
}

/** 解析 "1.2.3.4:443"、"[::1]:53"、"1.2.3.4" → { host, port } */
export function splitHostPort(s) {
  if (!s) return { host: '', port: '' }
  const str = String(s)
  const v6 = str.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (v6) return { host: v6[1], port: v6[2] || '' }
  const idx = str.lastIndexOf(':')
  // 只有一个冒号才是 host:port；多个冒号是不带端口的 IPv6
  if (idx > 0 && str.indexOf(':') === idx) return { host: str.slice(0, idx), port: str.slice(idx + 1) }
  return { host: str, port: '' }
}
