/**
 * 版本检查：查询 GitHub 上面板与 mihomo 的最新版本
 * 这些请求由浏览器直接发给 GitHub（不经过 mihomo），失败时只影响「最新版本」的显示，不影响升级操作本身。
 */

/** 当前面板版本，构建时由 vite.config.js 注入（package.json 的 version） */
export const PANEL_VERSION = typeof __PANEL_VERSION__ !== 'undefined' ? __PANEL_VERSION__ : 'dev'

/** 面板所在 GitHub 仓库（owner/name），构建时注入；为空表示未配置 */
export const PANEL_REPO = typeof __PANEL_REPO__ !== 'undefined' ? __PANEL_REPO__ : ''

/**
 * 面板稳定下载地址（填到 mihomo 的 external-ui-url）：
 * 始终指向最新 Release 的 dist.zip，由 GitHub Actions 在版本号变化时自动发布
 */
export const PANEL_ZIP_URL = PANEL_REPO
  ? `https://github.com/${PANEL_REPO}/releases/latest/download/dist.zip`
  : ''

async function getJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(res.status === 403 ? 'GitHub 请求过于频繁，请稍后再试' : `HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 面板最新版本：最新 Release 的标签（去掉开头的 v），与 dist.zip 下载地址保持一致 */
export async function fetchLatestPanelVersion() {
  if (!PANEL_REPO) throw new Error('构建时未设置仓库')
  const d = await getJson(`https://api.github.com/repos/${PANEL_REPO}/releases/latest`)
  return String(d.tag_name || '').replace(/^v/, '')
}

const MIHOMO_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases'

/** mihomo Release 正式版最新版本，例如 v1.19.15 */
export async function fetchLatestRelease() {
  const d = await getJson(`${MIHOMO_API}/latest`)
  return d.tag_name
}

/** mihomo Alpha 预览版最新版本，例如 alpha-1a2b3c4（从附件文件名中解析） */
export async function fetchLatestAlpha() {
  const d = await getJson(`${MIHOMO_API}/tags/Prerelease-Alpha`)
  for (const a of d.assets || []) {
    const m = a.name.match(/(alpha-[0-9a-f]{6,})/)
    if (m) return m[1]
  }
  return d.name || 'Alpha'
}

/** 当前内核是否为 Alpha 版（mihomo 的 Alpha 版本号以 alpha 开头） */
export const isAlphaVersion = (v) => /^alpha/i.test(v || '')
