/**
 * 代理、代理组、延迟测试、proxy-providers 接口
 */
import { http } from './http'

const enc = encodeURIComponent

export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'

/** GET /proxies → { proxies: { [name]: Proxy } } */
export const getProxies = () => http.get('/proxies')

/** PUT /proxies/{group}  切换 Selector 组选中的节点 */
export const selectProxy = (group, name) => http.put(`/proxies/${enc(group)}`, { name })

/**
 * GET /proxies/{name}/delay  测单个节点延迟
 * @returns {Promise<{delay: number}>}
 * 超时时后端返回 408/504，失败返回 503，由调用方转成“超时”
 */
export const testProxyDelay = (name, { url = DEFAULT_TEST_URL, timeout = 5000 } = {}) =>
  http.get(`/proxies/${enc(name)}/delay`, {
    query: { url, timeout },
    timeout: timeout + 5000, // HTTP 超时要比测速超时长，否则会先被前端掐断
  })

/**
 * GET /group/{name}/delay  整组一键测速（mihomo 扩展接口）
 * @returns {Promise<Record<string, number>>}  { 节点名: 延迟 }，失败的节点不在结果里
 */
export const testGroupDelay = (group, { url = DEFAULT_TEST_URL, timeout = 5000 } = {}) =>
  http.get(`/group/${enc(group)}/delay`, {
    query: { url, timeout },
    timeout: timeout + 10000,
  })

/* ---------------- proxy-providers ---------------- */

/** GET /providers/proxies → { providers: { [name]: Provider } } */
export const getProxyProviders = () => http.get('/providers/proxies')

/** PUT /providers/proxies/{name}  立即更新订阅 */
export const updateProxyProvider = (name) =>
  http.put(`/providers/proxies/${enc(name)}`, undefined, { timeout: 60000 })

/** GET /providers/proxies/{name}/healthcheck  对整个集合做健康检查 */
export const healthcheckProxyProvider = (name) =>
  http.get(`/providers/proxies/${enc(name)}/healthcheck`, { timeout: 60000 })
