/**
 * Pido Service Worker（PWA 用）
 * - 只处理面板自身目录（scope）下的 GET 请求，后端 API / WebSocket 一律不经过这里
 * - 网络优先：有网时总是拿最新文件（面板更新后立即生效），断网时才用缓存兜底
 */
const CACHE = 'pido-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const scope = new URL(self.registration.scope)
  // 不在面板目录下（例如同源的 mihomo API /proxies、/configs）→ 不拦截
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(async () => {
        const hit = (await caches.match(req)) || (req.mode === 'navigate' && (await caches.match(scope.href)))
        return hit || Response.error()
      }),
  )
})
