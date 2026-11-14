/**
 * 在组件中订阅 WebSocket 数据流
 * - 组件（或 effect scope）销毁时自动断开
 * - 后端地址 / secret / 后端类型变化时自动重连（标准 API 由 ws.js 转为轮询 / SSE）
 * - query 传函数时，返回值变化也会重连（如日志级别）
 *
 * 用法：
 *   const { status } = useStream('/traffic', { onMessage: (d) => { ... } })
 */
import { ref, watch, onScopeDispose } from 'vue'
import { createStream } from '@/api/ws'
import { useBackendStore } from '@/stores/backend'

export function useStream(path, { query, onMessage } = {}) {
  const backend = useBackendStore()
  const status = ref('idle')
  let stream = null

  function start() {
    stream?.close()
    stream = createStream(path, {
      query,
      onMessage,
      onStatus: (s) => (status.value = s),
    })
  }

  start()
  watch(() => [backend.url, backend.secret, backend.kind], start)
  if (typeof query === 'function') watch(query, start, { deep: true })
  onScopeDispose(() => stream?.close())

  return { status, restart: start }
}
