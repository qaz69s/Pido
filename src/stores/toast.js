/**
 * 全局提示（Toast）队列
 * 用法：const toast = useToastStore(); toast.success('已切换')
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

let seq = 0
const MAX_TOASTS = 5

export const useToastStore = defineStore('toast', () => {
  /** @type {import('vue').Ref<{id:number,type:string,message:string}[]>} */
  const items = ref([])

  function push({ type = 'info', message, timeout = 3000 }) {
    const id = ++seq
    items.value.push({ id, type, message })
    if (items.value.length > MAX_TOASTS) items.value.shift()
    if (timeout > 0) setTimeout(() => remove(id), timeout)
    return id
  }

  function remove(id) {
    items.value = items.value.filter((t) => t.id !== id)
  }

  const info = (message, opts) => push({ ...opts, type: 'info', message })
  const success = (message, opts) => push({ ...opts, type: 'success', message })
  const warning = (message, opts) => push({ timeout: 4000, ...opts, type: 'warning', message })
  const error = (message, opts) => push({ timeout: 5000, ...opts, type: 'error', message })

  return { items, push, remove, info, success, warning, error }
})
