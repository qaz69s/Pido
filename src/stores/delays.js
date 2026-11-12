/**
 * 节点延迟缓存（全局，切换页面不丢失；同一标签页内刷新也保留，存在 sessionStorage）
 *
 * 为什么需要：mihomo 只在节点的 history 里保留「默认测速地址」的结果，
 * 用自定义地址测速或策略组自己的 testUrl 测速时，结果写在 extra[地址].history 里；
 * 只读 history 会导致刚测完的延迟在刷新后变回灰色的「--」。
 *
 * 每条记录带时间戳：后端 history 与面板测速结果中，谁更新用谁。
 */
import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

const KEY = 'mihomo-dashboard:delays'

/** 解析 history 条目的时间（Go 时间字符串），无效返回 0 */
const ts = (h) => {
  const t = Date.parse(h?.time)
  return Number.isFinite(t) && t > 0 ? t : 0
}

/** 取节点在后端记录里最新的一次延迟：同时查看 history 与 extra[*].history */
export function latestFromBackend(proxy) {
  let best = null
  const consider = (list) => {
    const last = list?.at?.(-1)
    if (!last) return
    const t = ts(last)
    if (!best || t >= best.t) best = { delay: last.delay, t }
  }
  consider(proxy?.history)
  for (const v of Object.values(proxy?.extra || {})) consider(v?.history)
  return best
}

export const useDelayStore = defineStore('delays', () => {
  let saved = {}
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || '{}')
  } catch {
    saved = {}
  }
  /** { 节点名: { delay: 毫秒（0=超时）, t: 时间戳 } } */
  const map = reactive(saved)
  watch(map, (v) => sessionStorage.setItem(KEY, JSON.stringify(v)), { deep: true })

  /** 面板自己测速的结果 */
  function set(name, delay) {
    map[name] = { delay, t: Date.now() }
  }

  /** 用 GET /proxies 的数据更新：后端记录更新时才覆盖 */
  function syncFromProxies(all) {
    for (const [name, p] of Object.entries(all || {})) {
      if (Array.isArray(p.all)) continue // 策略组本身没有延迟，显示时跟随其当前节点
      const b = latestFromBackend(p)
      if (b && (!map[name] || b.t >= map[name].t)) map[name] = b
    }
  }

  /**
   * 取显示用的延迟；策略组沿着 now 找到实际节点（最多 8 层，防止循环）
   * @returns {number|undefined} undefined = 未测
   */
  function get(name, all) {
    let cur = name
    for (let i = 0; i < 8 && cur; i++) {
      if (map[cur]) return map[cur].delay
      const p = all?.[cur]
      if (!p || !Array.isArray(p.all)) return undefined
      cur = p.now
    }
    return undefined
  }

  return { map, set, get, syncFromProxies }
})
