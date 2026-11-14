/**
 * 标准 API：配置编辑（dae ≥ 2.1.2 受管布局）、内联节点增删改、策略组参数
 * - 配置源清单取自 GET /config 的 sources[]（契约没有 GET /config/sources 列表路由）
 * - 替换配置源：PUT /config/sources/{id}，If-Match 为该源的 content_sha256（带双引号），
 *   成功返回 202 + reload 操作，轮询到结束才算生效
 * - 校验：POST /config/validate（不落盘）
 * - 节点：POST /nodes、PATCH /nodes/{id}（dae 扩展）、DELETE /nodes/{id}，均可能 202 + 操作
 * - 组参数：GET/PATCH /groups/{id}/config，JSON Patch（application/json-patch+json）+ If-Match（配置 revision）
 * 写入闸门：dae 需要 api.config_write: true 且配置目录为受管布局，否则 403 permission_denied（details.reason）
 */
import { std, waitOperation, withRetry, getCapabilities, errorDetails } from './client'

const enc = encodeURIComponent
/** 写操作完成（含 reload）最长等待 */
const WRITE_TIMEOUT = 120000

/** 202 → 等操作结束；200/201 → 直接返回结果 */
async function settle(res) {
  if (res && typeof res === 'object' && res.operation_id) {
    const op = await waitOperation(res, { timeout: WRITE_TIMEOUT })
    return op?.result ?? op
  }
  return res
}

/* ---------------- 写入能力 ---------------- */

/**
 * 读取配置写入相关的能力
 * @returns {Promise<{available, writable, reason, layout, validateModes, maxBytes, nodesManage, groupPatch}>}
 *   reason：dae 的 x-dae.layout.reason（writes_disabled | layout_unmanaged），可写时为空
 */
export async function getWriteCaps({ force = false } = {}) {
  const c = await getCapabilities({ force })
  const r = c?.resources || {}
  const cfg = r.config || {}
  const xdae = cfg['x-dae'] || {}
  return {
    available: cfg.available !== false && !!r.config,
    writable: !!cfg.writable,
    reason: xdae.layout?.reason || (cfg.writable ? '' : 'writes_disabled'),
    layout: xdae.layout?.kind || '',
    hiddenSources: xdae.hidden_sources || [],
    maxBytes: cfg.max_bytes || 0,
    validate: r.config_validate?.available ? r.config_validate.modes || ['syntax'] : [],
    nodesManage: !!r.nodes?.can_manage,
    groupPatch: !!r.groups?.config_patch,
  }
}

/* ---------------- 配置源 ---------------- */

/** GET /config → { generation_id, revision, sources: [...], diagnostics, secrets_redacted } */
export const getEffectiveConfig = () => std.get('/config')

/** GET /config/sources/{id} → { source, etag }（etag 只在内容未被脱敏时存在） */
export async function getConfigSource(id) {
  const { data, etag } = await std.get(`/config/sources/${enc(id)}`, { withMeta: true })
  return { source: data, etag }
}

/**
 * POST /config/validate
 * @param {Array<{id?: string, path?: string, content: string}>} sources 第一项为主源
 * @param {'syntax'|'full'} mode
 */
export const validateConfig = (sources, mode = 'full') =>
  std.post('/config/validate', { sources, mode }, { timeout: 30000 })

/**
 * PUT /config/sources/{id}，等待 reload 完成
 * @param {string} sha 读取时的 content_sha256
 */
export async function replaceConfigSource(id, content, sha) {
  const res = await std.put(`/config/sources/${enc(id)}`, { content }, {
    headers: { 'If-Match': `"${sha}"` },
    timeout: 30000,
  })
  return settle(res)
}

/** 422 / 失败操作里的诊断列表 */
export function diagnosticsOf(e) {
  return errorDetails(e)?.diagnostics || e?.detail?.details?.diagnostics || null
}

/** 403 的原因（writes_disabled | layout_unmanaged | entry_source | listener_secret_in_content …） */
export const denyReasonOf = (e) => errorDetails(e)?.reason || ''

/**
 * 计算文本的 SHA-256（十六进制）；非安全上下文（http://局域网 IP）没有 crypto.subtle 时返回 null
 * 用于确认读到的内容未被脱敏（契约：脱敏文本不得作为替换内容保存）
 */
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- 节点 ---------------- */

/** POST /nodes { name, link } → 新节点 */
export const createNode = (name, link) => withRetry(() => std.post('/nodes', { name, link }, { timeout: 30000 })).then(settle)

/** PATCH /nodes/{id} { name?, link? }（dae 扩展；只改名时 id 不变） */
export const updateNode = (id, patch) => std.patch(`/nodes/${enc(id)}`, patch, { timeout: 30000 }).then(settle)

/** DELETE /nodes/{id}（幂等，未知 id 返回 deleted: 0） */
export const deleteNode = (id) => std.del(`/nodes/${enc(id)}`, { timeout: 30000 }).then(settle)

/* ---------------- 策略组参数 ---------------- */

/** GET /groups/{id}/config → { doc: { policy, config }, etag } */
export async function getGroupConfig(id) {
  const { data, etag } = await std.get(`/groups/${enc(id)}/config`, { withMeta: true })
  return { doc: data, etag }
}

/** GET /groups/{id}（读 capabilities.mutable_config） */
export const getGroup = (id) => std.get(`/groups/${enc(id)}`)

/**
 * PATCH /groups/{id}/config（JSON Patch），等待 group_update 完成
 * @param {Array<{op: string, path: string, value: any}>} ops
 * @param {string} etag GET 返回的 ETag（已带引号）
 */
export async function patchGroupConfig(id, ops, etag) {
  const res = await std.patch(`/groups/${enc(id)}/config`, ops, {
    headers: { 'If-Match': etag },
    contentType: 'application/json-patch+json',
    timeout: 30000,
  })
  return settle(res)
}
