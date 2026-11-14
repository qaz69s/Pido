/**
 * 后端类型自动识别
 * - 标准 API（dae ≥ 2.1.2 / honk）：GET {地址}/api 是公开的 discovery，无需凭证，
 *   返回 { name: 'daeuniverse/native', api_major: 1, … }
 * - 其它情况一律按 mihomo（Clash API）处理，之后用 GET /version 验证
 */
import { request } from './http'
import { isDiscovery } from './standard/client'

/** 用户可能直接粘贴了面板地址（…/ui）或 API 地址（…/api、…/api/v1），去掉这些后缀再试 */
function candidates(baseUrl) {
  const stripped = baseUrl.replace(/\/(ui|api(\/v1)?)\/?$/i, '')
  return stripped !== baseUrl ? [stripped, baseUrl] : [baseUrl]
}

/**
 * 读取 discovery 文档，不是标准 API 时返回 null（不抛错）
 * @param {string} baseUrl 已规范化的后端地址
 */
export async function fetchDiscovery(baseUrl, { timeout = 6000, rethrowTimeout = false } = {}) {
  try {
    // discovery 是公开的：不带 secret，避免把凭证发给未知的路径
    const d = await request('/api', { baseUrl, secret: '', timeout, skipAuthHandler: true })
    return isDiscovery(d) ? d : null
  } catch (e) {
    // 超时说明后端不可达，没必要再等一次 /version
    if (rethrowTimeout && (e?.type === 'timeout' || e?.type === 'mixed-content')) throw e
    return null
  }
}

/**
 * 识别后端类型
 * @returns {Promise<{kind: 'mihomo'|'standard', baseUrl: string, discovery?: object}>}
 */
export async function detectBackend(baseUrl) {
  for (const url of candidates(baseUrl)) {
    const d = await fetchDiscovery(url, { rethrowTimeout: url === baseUrl })
    if (d) return { kind: 'standard', baseUrl: url, discovery: d }
  }
  return { kind: 'mihomo', baseUrl }
}
