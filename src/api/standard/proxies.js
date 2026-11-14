/**
 * 标准 API：策略组、节点、测速、订阅（providers）
 * 输出整理成 mihomo /proxies、/providers/proxies 的形状，代理页无需关心后端类型：
 *   proxies[名称] = { name, type, now?, all?, icon?, history: [{ time, delay }] }
 * 差异：
 * - 只有 policy.kind = selector（capabilities.can_select）的组能手动切换，type 记为 'Selector'
 * - 自动策略（urltest / score / random …）显示当前成员但不可点选；fixed 同样不可选
 * - 测速走 POST /probes（kind=http）+ 轮询 operation，测速地址由后端配置决定（不支持自定义 URL）
 */
import { ApiError } from '../http'
import {
  std,
  toNum,
  getCapabilities,
  groupArray,
  listAllNodes,
  listAllProviders,
  rememberName,
  markNamesFresh,
  nameOf,
  idOf,
  waitOperation,
  withRetry,
} from './client'

const enc = encodeURIComponent

/** 策略类型 → 显示名（与 mihomo 的组类型写法保持一致） */
const POLICY_TYPE = {
  selector: 'Selector',
  urltest: 'URLTest',
  fallback: 'Fallback',
  loadbalance: 'LoadBalance',
  random: 'Random',
  score: 'Score',
  fixed: 'Fixed',
}

/** 节点协议 → 显示名 */
const PROTOCOL_NAME = {
  ss: 'Shadowsocks',
  shadowsocks: 'Shadowsocks',
  ssr: 'ShadowsocksR',
  vmess: 'Vmess',
  vless: 'Vless',
  trojan: 'Trojan',
  hysteria2: 'Hysteria2',
  tuic: 'Tuic',
  juicity: 'Juicity',
  anytls: 'AnyTLS',
  naive: 'Naive',
  socks: 'Socks5',
  socks5: 'Socks5',
  http: 'Http',
  https: 'Http',
  direct: 'Direct',
}
const protocolName = (p) => (p ? PROTOCOL_NAME[String(p).toLowerCase()] || String(p) : '')

/**
 * 从健康观测里取一个“延迟”：优先 TCP 数据通道（purpose=data，代理实际走的路径）
 * @returns {{delay: number, time: string} | null}  delay=0 表示不可用
 */
export function delayFromHealth(health) {
  const list = Array.isArray(health) ? health : []
  if (!list.length) return null
  const pick = (pred) => list.filter(pred)
  let cand = pick((h) => h.transport === 'tcp' && h.purpose === 'data')
  if (!cand.length) cand = pick((h) => h.purpose === 'data')
  if (!cand.length) cand = list
  const healthy = cand.filter((h) => h.state === 'healthy' && toNum(h.latency_ms) != null)
  const latest = (arr) => arr.map((h) => h.observed_at).filter(Boolean).sort().at(-1) || ''
  if (healthy.length) {
    return { delay: Math.max(1, Math.round(Math.min(...healthy.map((h) => toNum(h.latency_ms))))), time: latest(healthy) }
  }
  if (cand.some((h) => h.state === 'unavailable')) return { delay: 0, time: latest(cand) }
  return null // unknown：没有可下结论的观测
}

/** 节点 → mihomo 形状 */
function mapNode(n) {
  const d = delayFromHealth(n.health)
  return {
    name: n.name,
    type: protocolName(n.protocol),
    udp: undefined,
    history: d ? [{ time: d.time, delay: d.delay }] : [],
    extra: {},
    _id: n.id,
    _providerId: n.provider_id ?? null,
    _subscriptionTag: n.subscription_tag ?? null,
    _protocol: n.protocol || '',
  }
}

/** 组信息（测速 / 切换要用 id 和成员列表），按组名缓存 */
const groupInfo = new Map()
/** { 节点 id: 协议 }，测速时据此给 direct / block 选 http、其他协议可退回 tcp_connect */
const nodeProtocol = new Map()

/** GET /groups + 每组详情 + 全部节点 → { proxies } */
export async function getProxies() {
  const [summaries, nodes] = await Promise.all([std.get('/groups'), listAllNodes()])
  const list = groupArray(summaries)
  const details = await Promise.all(list.map((g) => std.get(`/groups/${enc(g.id)}`).catch(() => null)))

  const proxies = {}
  groupInfo.clear()
  nodeProtocol.clear()
  for (const n of nodes) {
    rememberName(n.id, n.name, 'node')
    nodeProtocol.set(n.id, String(n.protocol || '').toLowerCase())
  }
  for (const g of list) rememberName(g.id, g.name, 'group')
  markNamesFresh()

  list.forEach((s, i) => {
    const g = details[i] || s
    const kind = g.policy?.kind
    // 详情读不到时，用节点的 group_ids 反推成员（缺少嵌套组成员）
    const members =
      details[i]?.members ||
      nodes.filter((n) => (n.group_ids || []).includes(s.id)).map((n) => ({ id: n.id, name: n.name, kind: 'node' }))
    const canSelect = g.capabilities ? !!g.capabilities.can_select : kind === 'selector'
    const sel = g.runtime?.selection?.tcp?.member_id ?? s.selection?.tcp_member_id ?? null
    groupInfo.set(s.name, {
      id: s.id,
      members,
      probeTransports: g.capabilities?.probe_transports || ['tcp'],
    })
    proxies[s.name] = {
      name: s.name,
      // 只有可手动选择的组标为 Selector（ProxyGroupCard 据此决定能否点选节点）
      type: canSelect ? 'Selector' : POLICY_TYPE[kind] || g.policy?.native || kind || '',
      now: sel ? members.find((m) => m.id === sel)?.name ?? nameOf(sel) : '',
      all: members.map((m) => m.name),
      icon: s.icon || '',
      history: [],
      extra: {},
      _id: s.id,
      _policy: kind,
      _native: g.policy?.native,
      // 组参数编辑（PATCH /groups/{id}/config）用：可改字段与当前值
      _mutable: g.capabilities?.mutable_config || [],
      _config: g.config || null,
    }
  })
  for (const n of nodes) {
    // 组名与节点名同名时以组为准（显示上不会出错）
    if (!proxies[n.name]) proxies[n.name] = mapNode(n)
  }
  return { proxies }
}

/** PUT /groups/{id}/selection  切换 selector 组的成员（TCP 与 UDP 一起切） */
export async function selectProxy(group, name) {
  const info = groupInfo.get(group)
  const gid = info?.id ?? idOf(group)
  const member = info?.members.find((m) => m.name === name)
  return std.put(`/groups/${enc(gid)}/selection`, { member_id: member?.id ?? idOf(name), network: 'both' })
}

/* ---------------- 测速（probes） ---------------- */

/** 同时进行中的测速任务上限（后端也有排队上限，前端先限一下，避免 503 / 429） */
const MAX_JOBS = 2
let running = 0
const queue = []
function acquire() {
  if (running < MAX_JOBS) {
    running++
    return Promise.resolve()
  }
  return new Promise((r) => queue.push(r))
}
function release() {
  const next = queue.shift()
  if (next) next()
  else running--
}

/** 按能力声明选择探测参数：http 优先；IP 版本优先 IPv4 */
async function probeDims() {
  let p = {}
  try {
    p = (await getCapabilities())?.resources?.probes || {}
  } catch {
    /* 读不到能力信息时用契约的默认组合 */
  }
  if (p.available === false) {
    const e = new ApiError('http', '后端未开放节点测速（probes）', { status: 404 })
    e.backendKind = 'standard'
    throw e
  }
  const kinds = p.kinds || ['http']
  const versions = p.ip_versions
  return {
    kind: kinds.includes('http') ? 'http' : kinds.includes('tcp_connect') ? 'tcp_connect' : kinds[0],
    ip_version: !versions ? 'any' : versions.includes('ipv4') ? 'ipv4' : versions[0] || 'any',
    maxMembers: p.limits?.max_members_per_job || 256,
    jobTimeout: p.limits?.job_timeout_ms || 30000,
  }
}

/** 发起一次探测并等待结果 → ProbeResultItem[] */
async function runProbe(body, jobTimeout) {
  await acquire()
  try {
    const accepted = await withRetry(() => std.post('/probes', body, { timeout: 15000 }))
    const op = await waitOperation(accepted, { timeout: jobTimeout + 20000 })
    return op?.result?.results || []
  } finally {
    release()
  }
}

/** 把同一成员的多条结果（不同 transport / IP 版本）合成一个延迟；全部 unknown 时返回 undefined */
function mergeResults(items) {
  const byMember = new Map()
  for (const it of items) {
    if (!byMember.has(it.member_id)) byMember.set(it.member_id, [])
    byMember.get(it.member_id).push(it)
  }
  const out = new Map()
  for (const [id, arr] of byMember) {
    const ok = arr.filter((x) => x.state === 'healthy' && toNum(x.latency_ms) != null)
    if (ok.length) out.set(id, Math.max(1, Math.round(Math.min(...ok.map((x) => toNum(x.latency_ms))))))
    else if (arr.some((x) => x.state === 'unavailable')) out.set(id, 0)
  }
  return out
}

/** 422 unsupported_value 且后端提示改用 tcp_connect（该协议没有 HTTP 探测路径） */
function wantsTcpConnect(e) {
  const d = e?.detail?.error?.details || e?.detail?.details
  return e?.code === 'unsupported_value' && (!d?.allowed || d.allowed.includes('tcp_connect'))
}
const isDirectLike = (id) => ['direct', 'block', 'reject'].includes(nodeProtocol.get(id))

/**
 * 单节点测速：POST /probes { target: node }
 * 先用 http（与自动健康检查一致）；后端说该协议没有 HTTP 探测路径时退回 tcp_connect
 * @returns {Promise<{delay: number}>}  不可用时抛出 status=503 的错误（界面记为“超时”）
 */
export async function testProxyDelay(name) {
  const dims = await probeDims()
  const nodeId = idOf(name)
  const body = (kind) => ({
    target: { type: 'node', node_id: nodeId },
    kind,
    transport: ['tcp'],
    ip_version: dims.ip_version,
    warmth: 'cold',
  })
  let items
  try {
    items = await runProbe(body(dims.kind), dims.jobTimeout)
  } catch (e) {
    if (dims.kind === 'tcp_connect' || !wantsTcpConnect(e) || isDirectLike(nodeId)) throw e
    items = await runProbe(body('tcp_connect'), dims.jobTimeout)
  }
  const merged = mergeResults(items)
  const d = merged.get(nodeId) ?? [...merged.values()][0]
  if (d > 0) return { delay: d }
  if (d === 0) throw Object.assign(new ApiError('http', '节点不可用', { status: 503 }), { backendKind: 'standard' })
  throw Object.assign(new ApiError('http', '测速未完成（后端未给出结果）'), { backendKind: 'standard' })
}

/**
 * 整组测速：POST /probes { target: group, members }
 * - 成员数超过 max_members_per_job 时分批（显式列出成员 id）
 * - 整批被 422 拒绝（组里有不支持 HTTP 探测的协议）时：direct / block / 子组继续用 http，
 *   其余节点改用 tcp_connect，各自一批；某一批仍失败只丢掉那一批，不让整组报错
 * @returns {Promise<Record<string, number>>} { 成员名: 延迟 }，与 mihomo /group/{name}/delay 一致
 */
export async function testGroupDelay(group) {
  const dims = await probeDims()
  const info = groupInfo.get(group)
  const gid = info?.id ?? idOf(group)
  const members = info?.members || []
  const body = (kind, ids) => ({
    target: { type: 'group', group_id: gid },
    kind,
    transport: ['tcp'],
    ip_version: dims.ip_version,
    warmth: 'cold',
    members: ids || 'direct',
  })
  const chunks = (ids) => {
    const out = []
    for (let i = 0; i < ids.length; i += dims.maxMembers) out.push(ids.slice(i, i + dims.maxMembers))
    return out
  }
  const run = (kind, ids) => Promise.all(chunks(ids).map((c) => runProbe(body(kind, c), dims.jobTimeout))).then((r) => r.flat())

  let items
  try {
    items =
      !members.length || members.length <= dims.maxMembers
        ? await runProbe(body(dims.kind), dims.jobTimeout)
        : await run(dims.kind, members.map((m) => m.id))
  } catch (e) {
    if (!members.length || e?.code !== 'unsupported_value') throw e
    const httpIds = members.filter((m) => m.kind === 'group' || isDirectLike(m.id)).map((m) => m.id)
    const tcpIds = members.filter((m) => !httpIds.includes(m.id)).map((m) => m.id)
    const parts = await Promise.allSettled([
      httpIds.length ? run(dims.kind, httpIds) : [],
      tcpIds.length ? run('tcp_connect', tcpIds) : [],
    ])
    if (parts.every((p) => p.status === 'rejected')) throw parts[0].reason
    items = parts.flatMap((p) => (p.status === 'fulfilled' ? p.value : []))
  }
  const merged = mergeResults(items)
  const out = {}
  for (const [id, d] of merged) {
    const name = members.find((m) => m.id === id)?.name ?? nameOf(id)
    if (d > 0) out[name] = d // 超时的不放进结果，与 mihomo 一致（界面把缺失的记为超时）
  }
  return out
}

/* ---------------- providers（订阅） ---------------- */

const PROVIDER_VEHICLE = { subscription: 'Subscription', file: 'File', inline: 'Inline' }
/** { provider 名称: id } */
const providerIds = new Map()

/** GET /providers + 节点 → mihomo /providers/proxies 形状 */
export async function getProxyProviders() {
  const [list, nodes] = await Promise.all([listAllProviders(), listAllNodes().catch(() => [])])
  let canRefresh = true
  try {
    canRefresh = (await getCapabilities())?.resources?.providers?.can_refresh !== false
  } catch {
    /* 默认允许 */
  }
  const providers = {}
  providerIds.clear()
  for (const p of list) {
    providerIds.set(p.name, p.id)
    const t = p.traffic
    const total = toNum(t?.total_bytes)
    const expire = p.expires_at ? Math.floor(Date.parse(p.expires_at) / 1000) : 0
    providers[p.name] = {
      name: p.name,
      vehicleType: PROVIDER_VEHICLE[p.kind] || p.kind,
      updatedAt: p.updated_at,
      proxies: nodes.filter((n) => n.provider_id === p.id).map(mapNode),
      subscriptionInfo:
        total || expire
          ? { Upload: toNum(t?.upload_bytes) || 0, Download: toNum(t?.download_bytes) || 0, Total: total || 0, Expire: expire || 0 }
          : null,
      _id: p.id,
      _kind: p.kind,
      _nodeCount: p.node_count,
      _status: p.status,
      _lastError: p.last_error,
      // 只有订阅能刷新（inline / file 返回 capability_not_supported）
      _canUpdate: canRefresh && p.kind === 'subscription',
      _canHealthcheck: false,
    }
  }
  return { providers }
}

/** POST /providers/{id}/refresh，等待 provider_refresh 操作完成 */
export async function updateProxyProvider(name) {
  if (!providerIds.has(name)) await getProxyProviders().catch(() => null)
  const id = providerIds.get(name) ?? name
  const accepted = await withRetry(() => std.post(`/providers/${enc(id)}/refresh`, undefined, { timeout: 15000 }))
  return waitOperation(accepted, { timeout: 120000 })
}
