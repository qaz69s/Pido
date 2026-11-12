/**
 * 版本、配置与内核维护相关接口
 */
import { http } from './http'

/** GET /version → { version: 'v1.19.x', meta: true } */
export const getVersion = (opts) => http.get('/version', opts)

/** GET /configs → 当前运行配置（mode、端口、tun 等） */
export const getConfigs = () => http.get('/configs')

/**
 * PATCH /configs  局部修改运行配置（不写回配置文件，重启内核后失效）
 * 例：patchConfigs({ mode: 'global' })、patchConfigs({ tun: { enable: true } })
 */
export const patchConfigs = (partial) => http.patch('/configs', partial)

/**
 * PUT /configs?force=true  重新加载配置
 * path 为空时重新加载启动时使用的配置文件
 */
export const reloadConfigs = (path = '') =>
  http.put('/configs', { path, payload: '' }, { query: { force: true }, timeout: 30000 })

/** POST /configs/geo  更新 GeoIP / GeoSite 数据库（需要下载，较慢） */
export const updateGeoDatabase = () => http.post('/configs/geo', {}, { timeout: 120000 })

/** POST /cache/fakeip/flush  清空 FakeIP 缓存 */
export const flushFakeIpCache = () => http.post('/cache/fakeip/flush')

/** POST /cache/dns/flush  清空 DNS 缓存（较新的内核才有） */
export const flushDnsCache = () => http.post('/cache/dns/flush')

/** POST /restart  重启内核（连接会短暂中断） */
export const restartCore = () => http.post('/restart', {}, { timeout: 15000 })

/**
 * 升级 mihomo 内核：POST /upgrade
 * @param {'release'|'alpha'} channel 升级通道：Release 正式版 / Alpha 预览版
 * @param {boolean} force 已是最新版本时是否强制重新安装
 * 成功后内核会自动替换二进制并重启（嵌入模式下不可用，返回 404/405）
 */
export const upgradeCore = (channel, force = false) =>
  http.post('/upgrade', {}, { query: { channel, ...(force ? { force: 'true' } : {}) }, timeout: 180000 })

/**
 * 更新面板：POST /upgrade/ui
 * 内核会下载配置文件里 external-ui-url 指向的 zip，并覆盖 external-ui 目录
 */
export const upgradeUi = () => http.post('/upgrade/ui', {}, { timeout: 120000 })
