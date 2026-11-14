/**
 * 标准 API：版本、运行时、连接、规则、重载
 * 输出尽量整理成 mihomo 的数据形状，页面可以共用同一套展示代码
 */
import { std, toNum, nameOf, ensureNames, splitHostPort, waitOperation, withRetry } from './client'

const enc = encodeURIComponent

/* ---------------- 版本 ---------------- */

/**
 * GET /version → { version, engine, kind: 'standard', api, build }
 * engine 为小写引擎名（dae / honk），version 与 `dae -v` 一致
 */
export async function getVersion(opts) {
  const v = await std.get('/version', opts)
  return {
    version: v?.engine?.version || '',
    engine: v?.engine?.name || '',
    kind: 'standard',
    api: v?.api || null,
    build: v?.build || null,
  }
}

/* ---------------- 运行时 ---------------- */

/** GET /runtime（原样返回，供概览 / 配置页展示运行信息） */
export const getRuntime = () => std.get('/runtime')

/** GET /runtime/memory → 进程 RSS 字节数（拿不到时为 null） */
export async function getMemoryInuse() {
  const m = await std.get('/runtime/memory')
  return toNum(m?.process?.rss_bytes) ?? toNum(m?.cgroup?.current_bytes)
}

/**
 * GET /runtime/traffic/history → [{ up, down, t }]（按时间从旧到新）
 * 上限：window 3600 秒、180 个点（dae）；超范围会 400，这里取保守值
 */
export async function getTrafficHistory({ windowSeconds = 120, maxPoints = 60 } = {}) {
  const h = await std.get('/runtime/traffic/history', {
    query: { window_seconds: windowSeconds, max_points: maxPoints },
  })
  const samples = (h?.samples || []).map((s) => ({
    up: toNum(s.upload_bytes_per_second) || 0,
    down: toNum(s.download_bytes_per_second) || 0,
    t: s.sampled_at,
  }))
  // 采样间隔可能大于 1 秒（为满足 max_points 抽稀）：每个点按间隔重复，换算成“每秒一个点”，与实时曲线的时间轴一致
  const every = Math.min(Math.max(1, Math.round(toNum(h?.sampled_every_seconds) || 1)), 60)
  if (every === 1) return samples
  return samples.flatMap((s) => Array(every).fill(s)).slice(-maxPoints)
}

/** 运行时汇总里的速率 / 累计流量 / 连接数 */
export function trafficOf(runtime) {
  const t = runtime?.traffic || {}
  return {
    up: toNum(t.rates?.upload_bytes_per_second) || 0,
    down: toNum(t.rates?.download_bytes_per_second) || 0,
    uploadTotal: toNum(t.bytes?.upload) || 0,
    downloadTotal: toNum(t.bytes?.download) || 0,
    connections: toNum(t.connections?.total),
  }
}

/* ---------------- 连接 ---------------- */

/**
 * 标准 API 的连接 → mihomo 连接形状
 * - upload / download 可能为 null（UDP、内核直连、disable_connection_bytes），界面显示 "--"
 * - upRate / downRate：后端给出的每条连接速率（mihomo 没有，由前端用快照差计算）
 * - chain：契约顺序为 [组…, 叶子节点]，mihomo 的 chains 是 [节点, …, 组]，这里倒过来
 */
export function normalizeConnection(c, network) {
  const src = splitHostPort(c.src)
  const dst = splitHostPort(c.dst)
  const chain = (c.chain || []).map(nameOf)
  return {
    id: c.id,
    upload: toNum(c.upload_bytes),
    download: toNum(c.download_bytes),
    upRate: toNum(c.upload_bytes_per_second),
    downRate: toNum(c.download_bytes_per_second),
    start: c.started_at,
    chains: chain.length ? [...chain].reverse() : c.outbound ? [nameOf(c.outbound)] : [],
    rule: c.rule_expression || c.rule_id || '',
    rulePayload: '',
    metadata: {
      network,
      type: c.ingress ? c.ingress.toUpperCase() : '',
      host: c.domain || '',
      destinationIP: dst.host,
      destinationPort: dst.port,
      sourceIP: src.host,
      sourcePort: src.port,
      process: c.pname || '',
      domainSource: c.domain_source || '',
      observedBy: c.observed_by || '',
      ruleSource: c.rule_source || '',
    },
  }
}

/**
 * 一次连接快照，形状同 mihomo 的 /connections 推送：
 * { connections, uploadTotal, downloadTotal, total }
 * 累计流量来自 /runtime（契约的连接列表不带总量）
 */
export async function getConnectionsSnapshot() {
  await ensureNames()
  const [list, runtime] = await Promise.all([
    std.get('/connections', { query: { limit: 1000, detail: 'full' } }),
    std.get('/runtime').catch(() => null),
  ])
  const conns = [
    ...(list?.tcp || []).map((c) => normalizeConnection(c, 'tcp')),
    ...(list?.udp || []).map((c) => normalizeConnection(c, 'udp')),
  ]
  const t = trafficOf(runtime)
  const total = (toNum(list?.total_tcp) ?? 0) + (toNum(list?.total_udp) ?? 0)
  return {
    connections: conns,
    uploadTotal: t.uploadTotal,
    downloadTotal: t.downloadTotal,
    total: total || conns.length,
    truncated: !!list?.truncated,
  }
}

/** DELETE /connections/{id} */
export const closeConnection = (id) => std.del(`/connections/${enc(id)}`)

/** DELETE /connections?all=true（无过滤条件时契约要求显式 all=true） */
export const closeAllConnections = () => std.del('/connections', { query: { all: true } })

/* ---------------- 规则 ---------------- */

/**
 * dae 规则表达式 → { type, payload }
 *   "domain(geosite:cn)"            → { type: 'domain', payload: 'geosite:cn' }
 *   "l4proto(udp) && dport(443)"    → { type: '组合', payload: 原文 }
 */
function splitExpression(expr) {
  const s = String(expr || '').trim()
  const m = s.match(/^(!?[A-Za-z_][\w-]*)\((.*)\)$/s)
  // 只有一个函数调用（括号成对且内部没有再出现 ")&&" 之类）时拆开显示
  if (m && !/\)\s*(&&|\|\|)/.test(s)) return { type: m[1], payload: m[2] }
  if (/&&|\|\|/.test(s)) return { type: '组合', payload: s }
  return { type: '', payload: s }
}

/** GET /rules → { rules: [{ type, payload, proxy, size }] }（含最后的 fallback） */
export async function getRules() {
  const d = await std.get('/rules')
  const rules = (d?.rules || []).map((r) => {
    if (r.kind === 'fallback') return { type: 'fallback', payload: '', proxy: nameOf(r.outbound), size: -1 }
    const { type, payload } = splitExpression(r.expression)
    return { type, payload, proxy: nameOf(r.outbound), size: -1, _must: !!r.must }
  })
  // 个别实现把 fallback 单独放在 fallback 字段里
  if (d?.fallback && !rules.some((r) => r.type === 'fallback')) {
    rules.push({ type: 'fallback', payload: '', proxy: nameOf(d.fallback.outbound), size: -1 })
  }
  return { rules }
}

/* ---------------- 运维操作 ---------------- */

/** POST /operations/reload，等待 reload 操作结束 */
export async function reloadConfig() {
  const accepted = await withRetry(() => std.post('/operations/reload', {}, { timeout: 15000 }))
  return waitOperation(accepted, { timeout: 120000 })
}
