/**
 * 动画开关的读取工具（给非组件代码用，如主题切换、数字补间、Canvas 曲线）
 * - 真正的开关状态由 stores/motion.js 写到 <html data-motion="on|off">
 */
export function motionEnabled() {
  return document.documentElement.dataset.motion !== 'off'
}
