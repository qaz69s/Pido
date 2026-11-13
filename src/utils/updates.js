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

/**
 * jsDelivr 的仓库版本列表：国内通常可直连、没有 GitHub API 每小时 60 次的限制，
 * 作为 GitHub API 失败时的备用来源（只含正式版标签，不含 Alpha）
 */
async function latestFromJsdelivr(repo) {
  const d = await getJson(`https://data.jsdelivr.com/v1/packages/gh/${repo}`)
  const v = d.versions?.[0]?.version
  if (!v) throw new Error('jsDelivr 无版本数据')
  return v
}

/** 依次尝试多个来源，返回第一个成功的结果；全部失败时抛出第一个错误 */
async function firstOk(fns) {
  let first
  for (const fn of fns) {
    try {
      return await fn()
    } catch (e) {
      first = first || e
    }
  }
  throw first
}

/** 面板最新版本：最新 Release 的标签（去掉开头的 v），与 dist.zip 下载地址保持一致 */
export async function fetchLatestPanelVersion() {
  if (!PANEL_REPO) throw new Error('构建时未设置仓库')
  return firstOk([
    async () => String((await getJson(`https://api.github.com/repos/${PANEL_REPO}/releases/latest`)).tag_name || '').replace(/^v/, ''),
    () => latestFromJsdelivr(PANEL_REPO),
  ])
}

const MIHOMO_REPO = 'MetaCubeX/mihomo'
const MIHOMO_API = `https://api.github.com/repos/${MIHOMO_REPO}/releases`

/** mihomo Release 正式版最新版本，例如 v1.19.15 */
export async function fetchLatestRelease() {
  return firstOk([
    async () => (await getJson(`${MIHOMO_API}/latest`)).tag_name,
    async () => 'v' + (await latestFromJsdelivr(MIHOMO_REPO)),
  ])
}

/** mihomo Alpha 预览版最新版本，例如 alpha-1a2b3c4（从附件文件名中解析；只有 GitHub API 能查到） */
export async function fetchLatestAlpha() {
  const d = await getJson(`${MIHOMO_API}/tags/Prerelease-Alpha`)
  for (const a of d.assets || []) {
    const m = a.name.match(/(alpha-[0-9a-f]{6,})/)
    if (m) return m[1]
  }
  return d.name || 'Alpha'
}

/* ---------- 结果缓存：30 分钟内重复打开配置页不再请求，避免触发 GitHub 频率限制 ---------- */
const CACHE_KEY = 'mihomo-dashboard:latest-versions'
const CACHE_TTL = 30 * 60 * 1000

export function readLatestCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (c && Date.now() - c.time < CACHE_TTL) return c.data
  } catch {
    /* 忽略损坏的缓存 */
  }
  return null
}

export function writeLatestCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data }))
  } catch {
    /* 存储已满等情况忽略 */
  }
}

/** 当前内核是否为 Alpha 版（mihomo 的 Alpha 版本号以 alpha 开头） */
export const isAlphaVersion = (v) => /^alpha/i.test(v || '')
