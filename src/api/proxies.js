/**
 * 代理、代理组、延迟测试、proxy-providers 接口
 * 后端为 dae / honk（标准 API）时转到 ./standard/proxies.js，返回相同形状的数据
 */
import { http, isStandard } from './http'
import * as std from './standard/proxies'

const enc = encodeURIComponent

export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'

/** GET /proxies → { proxies: { [name]: Proxy } } */
export const getProxies = () => (isStandard() ? std.getProxies() : http.get('/proxies'))

/** PUT /proxies/{group}  切换 Selector 组选中的节点 */
export const selectProxy = (group, name) =>
  isStandard() ? std.selectProxy(group, name) : http.put(`/proxies/${enc(group)}`, { name })

/**
 * 测单个节点延迟
 * - 配置文件里的节点：GET /proxies/{name}/delay
 * - proxy-provider（订阅）里的节点：mihomo 的 /proxies/{name} 找不到它们（返回 404），
 *   要走 GET /providers/proxies/{provider}/{name}/healthcheck，传入 provider 即可
 * @returns {Promise<{delay: number}>}
 * 超时时后端返回 408/504，失败返回 503，由调用方转成“超时”
 */
export const testProxyDelay = (name, { url = DEFAULT_TEST_URL, timeout = 5000, provider } = {}) => {
  if (isStandard()) return std.testProxyDelay(name)
  const path = provider
    ? `/providers/proxies/${enc(provider)}/${enc(name)}/healthcheck`
    : `/proxies/${enc(name)}/delay`
  return http.get(path, {
    query: { url, timeout },
    timeout: timeout + 5000, // HTTP 超时要比测速超时长，否则会先被前端掐断
  })
}

/**
 * GET /group/{name}/delay  整组一键测速（mihomo 扩展接口）
 * @returns {Promise<Record<string, number>>}  { 节点名: 延迟 }，失败的节点不在结果里
 */
export const testGroupDelay = (group, { url = DEFAULT_TEST_URL, timeout = 5000 } = {}) =>
  isStandard() ? std.testGroupDelay(group) : http.get(`/group/${enc(group)}/delay`, {
    query: { url, timeout },
    timeout: timeout + 10000,
  })

/* ---------------- proxy-providers ---------------- */

/** GET /providers/proxies → { providers: { [name]: Provider } } */
export const getProxyProviders = () => (isStandard() ? std.getProxyProviders() : http.get('/providers/proxies'))

/** PUT /providers/proxies/{name}  立即更新订阅 */
export const updateProxyProvider = (name) =>
  isStandard() ? std.updateProxyProvider(name) : http.put(`/providers/proxies/${enc(name)}`, undefined, { timeout: 60000 })

/** GET /providers/proxies/{name}/healthcheck  对整个集合做健康检查 */
export const healthcheckProxyProvider = (name) =>
  http.get(`/providers/proxies/${enc(name)}/healthcheck`, { timeout: 60000 })
