/**
 * 连接相关接口
 * 实时连接列表走 WebSocket：useStream('/connections', { query: { interval: 1000 } })
 * 每条推送是完整快照：{ downloadTotal, uploadTotal, memory, connections: Connection[] | null }
 * dae / honk（标准 API）由 standard/streams.js 轮询 GET /api/v1/connections，推送相同形状的快照
 */
import { http, isStandard } from './http'
import * as std from './standard/data'

/** GET /connections  获取一次连接快照 */
export const getConnections = () => (isStandard() ? std.getConnectionsSnapshot() : http.get('/connections'))

/** DELETE /connections  关闭全部连接 */
export const closeAllConnections = () => (isStandard() ? std.closeAllConnections() : http.del('/connections'))

/** DELETE /connections/{id}  关闭单个连接 */
export const closeConnection = (id) =>
  isStandard() ? std.closeConnection(id) : http.del(`/connections/${encodeURIComponent(id)}`)
