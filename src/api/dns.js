/**
 * DNS 接口
 * - mihomo：GET /dns/query?name=&type= 查询；POST /cache/dns/flush、/cache/fakeip/flush 清缓存
 * - dae / honk（标准 API）：
 *   GET  /api/v1/dns/log      查询日志（最新在前，name 为子串匹配，cursor 分页）
 *   GET  /api/v1/dns/cache    缓存（name/domain/type 过滤，cursor 分页，detail=full 带答案）
 *   DELETE /api/v1/dns/cache/{entry_id}、DELETE /api/v1/dns/cache?name=、POST /api/v1/dns/cache/flush
 *   POST /api/v1/dns/query    诊断查询（cache_mode normal|bypass、upstream 强制上游；限流 60 次/分钟）
 *   GET  /api/v1/dns/rules    只读 DNS 规则（request / response 两张表，各自以 fallback 结尾）
 *   DNS controller 未运行时以上接口返回 503 temporarily_unavailable
 */
import { http, isStandard } from './http'
import { std } from './standard/client'

const enc = encodeURIComponent

/* ---------------- 标准 API ---------------- */

/** GET /dns/log → { records, next_cursor, total } */
export const getDnsLog = ({ name, type, src, limit = 100, cursor } = {}) =>
  std.get('/dns/log', { query: { name, type, src, limit, cursor } })

/** GET /dns/cache → { entries, next_cursor, total, usage, coverage } */
export const getDnsCache = ({ name, type, limit = 100, cursor } = {}) =>
  std.get('/dns/cache', { query: { name, type, limit, cursor, detail: 'full' } })

/** DELETE /dns/cache/{entry_id} → { deleted } */
export const deleteDnsEntry = (id) => std.del(`/dns/cache/${enc(id)}`)

/** DELETE /dns/cache?name= → { matched, deleted }（name 必须是完整域名） */
export const deleteDnsByName = (name, type) => std.del('/dns/cache', { query: { name, type } })

/** POST /dns/cache/flush → { matched, deleted } */
export const flushStandardDnsCache = () => std.post('/dns/cache/flush', {})

/** GET /dns/rules → { generation_id, request: [], response: [] } */
export const getDnsRules = () => std.get('/dns/rules')

/* ---------------- 查询（两种后端统一） ---------------- */

/**
 * 解析一个域名
 * @param {{domain: string, types: string[], upstream?: string, bypass?: boolean}} q
 * @returns {Promise<{results: Array<{type, status, cached, upstream, elapsed_ms, answers: Array<{name,type,ttl,data}>}>, elapsed: number}>}
 *   elapsed：前端测得的整次请求耗时（毫秒）
 */
export async function queryDns({ domain, types, upstream, bypass }) {
  const t0 = performance.now()
  if (isStandard()) {
    const r = await std.post(
      '/dns/query',
      { domain, type: types, ...(upstream ? { upstream } : {}), cache_mode: bypass ? 'bypass' : 'normal' },
      { timeout: 15000 },
    )
    return { results: r?.results || [], elapsed: Math.round(performance.now() - t0) }
  }
  // mihomo：每种类型一次请求
  const results = await Promise.all(
    types.map(async (type) => {
      const s = performance.now()
      const r = await http.get('/dns/query', { query: { name: domain, type }, timeout: 15000 })
      return {
        type,
        status: RCODE[r?.Status] ?? (r?.Status != null ? `RCODE ${r.Status}` : '--'),
        cached: null,
        upstream: null,
        elapsed_ms: Math.round(performance.now() - s),
        answers: (r?.Answer || []).map((a) => ({ name: a.name, type: RRTYPE[a.type] || a.type, ttl: a.TTL, data: a.data })),
      }
    }),
  )
  return { results, elapsed: Math.round(performance.now() - t0) }
}

const RCODE = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' }
const RRTYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 64: 'SVCB', 65: 'HTTPS' }
