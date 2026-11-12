/**
 * 连接数据的展示与计算辅助函数
 */

/** 目标主机：优先域名，其次嗅探到的域名，最后 IP */
export function connHost(c) {
  const m = c.metadata || {}
  return m.host || m.sniffHost || m.destinationIP || m.remoteDestination || '未知'
}

/** 目标主机 + 端口，IPv6 地址加方括号 */
export function connTarget(c) {
  const host = connHost(c)
  const port = c.metadata?.destinationPort
  if (!port) return host
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

/**
 * 代理链路
 * mihomo 返回的 chains 顺序是 [实际节点, …, 最外层代理组]，倒过来更符合直觉：组 → 节点
 */
export function connChain(c) {
  return [...(c.chains || [])].reverse()
}

/** 最终出站节点（链路最后一跳） */
export function connOutbound(c) {
  return c.chains?.[0] || ''
}

/** 命中的规则，如 "DomainSuffix(google.com)"、"Match" */
export function connRule(c) {
  return c.rulePayload ? `${c.rule}(${c.rulePayload})` : c.rule || ''
}

/** 来源：进程名优先，否则来源 IP */
export function connSource(c) {
  const m = c.metadata || {}
  return m.process || m.sourceIP || ''
}

/** 用于搜索的整行文本（小写） */
export function connSearchText(c) {
  const m = c.metadata || {}
  return [
    m.host,
    m.sniffHost,
    m.destinationIP,
    m.destinationPort,
    m.sourceIP,
    m.process,
    m.processPath,
    m.network,
    m.type,
    m.inboundName,
    c.rule,
    c.rulePayload,
    ...(c.chains || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
