/**
 * 规则与 rule-providers 接口
 */
import { http, isStandard } from './http'
import * as std from './standard/data'

const enc = encodeURIComponent

/**
 * GET /rules → { rules: [{ type, payload, proxy, size }] }
 * size：RULE-SET / GEOSITE / GEOIP 等规则包含的条目数，普通规则为 -1
 */
export const getRules = () => (isStandard() ? std.getRules() : http.get('/rules'))

/**
 * GET /providers/rules → { providers: { [name]: RuleProvider } }
 * RuleProvider: { name, behavior, format, ruleCount, type, vehicleType, updatedAt }
 */
export const getRuleProviders = () =>
  isStandard() ? Promise.resolve({ providers: {} }) : http.get('/providers/rules') // 标准 API 没有规则集合

/** PUT /providers/rules/{name}  立即更新规则集合（远程的会重新下载） */
export const updateRuleProvider = (name) =>
  http.put(`/providers/rules/${enc(name)}`, undefined, { timeout: 60000 })
