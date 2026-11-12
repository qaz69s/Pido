/**
 * 全局确认框（代替 window.confirm，深浅色一致、手机上也好看）
 * 用法：
 *   const confirm = useConfirmStore()
 *   if (await confirm.ask({ title: '关闭全部连接？', danger: true })) { ... }
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useConfirmStore = defineStore('confirm', () => {
  const open = ref(false)
  const options = ref({})
  let resolver = null

  /**
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.message]
   * @param {string} [opts.confirmText] 默认“确定”
   * @param {boolean} [opts.danger]     危险操作用红色按钮
   * @returns {Promise<boolean>}
   */
  function ask(opts) {
    // 若已有未关闭的确认框，先按“取消”处理
    resolver?.(false)
    options.value = { confirmText: '确定', ...opts }
    open.value = true
    return new Promise((resolve) => (resolver = resolve))
  }

  function settle(result) {
    open.value = false
    resolver?.(result)
    resolver = null
  }

  return { open, options, ask, settle }
})
