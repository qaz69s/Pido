/**
 * 长列表分批渲染：先渲染 step 条，滚动到底部哨兵元素时自动追加
 * 规则可能有上万条，一次性渲染会明显卡顿
 *
 * 用法：
 *   const { visible, sentinel, hasMore, reset } = useInfiniteList(filteredList, 200)
 *   <div v-for="x in visible" /> <div ref="sentinel" />
 */
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'

export function useInfiniteList(source, step = 200) {
  const limit = ref(step)
  const sentinel = ref(null)
  let observer = null

  const visible = computed(() => source.value.slice(0, limit.value))
  const hasMore = computed(() => source.value.length > limit.value)

  function more() {
    if (hasMore.value) limit.value += step
  }

  function reset() {
    limit.value = step
  }

  // 哨兵元素出现在视口（提前 400px）时加载下一批
  watch(sentinel, (el) => {
    observer?.disconnect()
    if (!el || typeof IntersectionObserver === 'undefined') return
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || !hasMore.value) return
        more()
        // 追加后哨兵可能仍在视口内，重新观察一次以便继续触发
        nextTick(() => {
          observer?.unobserve(el)
          observer?.observe(el)
        })
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(el)
  })

  onBeforeUnmount(() => observer?.disconnect())

  return { visible, sentinel, hasMore, more, reset }
}
