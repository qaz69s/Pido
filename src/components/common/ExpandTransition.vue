<script setup>
/**
 * 高度展开/收起过渡：包住一个 v-if 或 v-show 的元素即可
 * - 高度从 0 平滑拉开到内容实际高度（收起反之），同时淡入淡出
 * - fadeOnly：内容很大时只做淡入淡出 + 轻微位移（只动 opacity/transform，交给 GPU，不触发逐帧排版）
 * - 动画关闭时直接显示/隐藏
 *
 * 性能要点：
 * - 动画期间给元素加 contain: layout paint，内部节点不会参与外部的逐帧排版
 * - 起始值写入后用 requestAnimationFrame 进入下一帧再改目标值，避免同步强制回流
 */
import { motionEnabled } from '@/utils/motion'

const props = defineProps({
  fadeOnly: Boolean,
})

const DURATION = 240
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

function run(el, from, to, done) {
  if (!motionEnabled()) return done()
  const id = (el._expandId = (el._expandId || 0) + 1) // 被打断（快速连点）时丢弃旧的帧回调
  const props_ = Object.keys(from)
  el.style.transition = 'none'
  el.style.contain = 'layout paint'
  if (from.height !== undefined) el.style.overflow = 'hidden'
  for (const k of props_) el.style[k] = from[k]

  let timer = 0
  const finish = (e) => {
    if (e && e.target !== el) return
    el.removeEventListener('transitionend', finish)
    clearTimeout(timer)
    done()
  }
  requestAnimationFrame(() => {
    if (el._expandId !== id) return
    requestAnimationFrame(() => {
      if (el._expandId !== id) return
      el.style.transition = props_.map((k) => `${k === 'transform' ? 'transform' : k} ${DURATION}ms ${EASE}`).join(', ')
      for (const k of props_) el.style[k] = to[k]
      el.addEventListener('transitionend', finish)
      timer = setTimeout(finish, DURATION + 80) // 兜底：transitionend 偶尔不触发
    })
  })
}

function clear(el) {
  for (const k of ['overflow', 'height', 'opacity', 'transform', 'transition', 'contain']) el.style[k] = ''
}

function onEnter(el, done) {
  if (props.fadeOnly) return run(el, { opacity: '0', transform: 'translateY(-6px)' }, { opacity: '1', transform: 'none' }, done)
  run(el, { height: '0px', opacity: '0' }, { height: `${el.scrollHeight}px`, opacity: '1' }, done)
}
function onLeave(el, done) {
  if (props.fadeOnly) return run(el, { opacity: '1', transform: 'none' }, { opacity: '0', transform: 'translateY(-6px)' }, done)
  run(el, { height: `${el.offsetHeight}px`, opacity: '1' }, { height: '0px', opacity: '0' }, done)
}
</script>

<template>
  <Transition :css="false" @enter="onEnter" @after-enter="clear" @leave="onLeave" @after-leave="clear" @enter-cancelled="clear" @leave-cancelled="clear">
    <slot />
  </Transition>
</template>
