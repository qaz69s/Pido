<script setup>
/**
 * 高度展开/收起过渡：包住一个 v-if 的元素即可
 * 高度从 0 平滑拉开到内容实际高度（收起反之），同时淡入淡出
 * 动画关闭时直接显示/隐藏
 */
import { motionEnabled } from '@/utils/motion'

const DURATION = 260
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

function run(el, from, to, done) {
  if (!motionEnabled()) return done()
  el.style.overflow = 'hidden'
  el.style.height = from.h
  el.style.opacity = from.o
  void el.offsetHeight // 强制回流，让起始值生效
  el.style.transition = `height ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`
  el.style.height = to.h
  el.style.opacity = to.o
  const finish = (e) => {
    if (e && e.target !== el) return
    el.removeEventListener('transitionend', finish)
    clearTimeout(timer)
    done()
  }
  el.addEventListener('transitionend', finish)
  const timer = setTimeout(finish, DURATION + 80) // 兜底：transitionend 偶尔不触发
}

function clear(el) {
  el.style.overflow = ''
  el.style.height = ''
  el.style.opacity = ''
  el.style.transition = ''
}

const onEnter = (el, done) => run(el, { h: '0px', o: '0' }, { h: `${el.scrollHeight}px`, o: '1' }, done)
const onLeave = (el, done) => run(el, { h: `${el.scrollHeight}px`, o: '1' }, { h: '0px', o: '0' }, done)
</script>

<template>
  <Transition :css="false" @enter="onEnter" @after-enter="clear" @leave="onLeave" @after-leave="clear">
    <slot />
  </Transition>
</template>
