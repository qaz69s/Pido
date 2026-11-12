/**
 * 连接相关接口
 * 实时连接列表走 WebSocket：useStream('/connections', { query: { interval: 1000 } })
 * 每条推送是完整快照：{ downloadTotal, uploadTotal, memory, connections: Connection[] | null }
 */
import { http } from './http'

/** GET /connections  获取一次连接快照 */
export const getConnections = () => http.get('/connections')

/** DELETE /connections  关闭全部连接 */
export const closeAllConnections = () => http.del('/connections')

/** DELETE /connections/{id}  关闭单个连接 */
export const closeConnection = (id) => http.del(`/connections/${encodeURIComponent(id)}`)
