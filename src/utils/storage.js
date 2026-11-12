/**
 * localStorage 小工具：统一 key 前缀，读写失败（隐私模式、配额满）时静默降级
 */
const PREFIX = 'mihomo-dashboard:'

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function loadString(key, fallback = '') {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveString(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    /* ignore */
  }
}

export function removeItem(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}
