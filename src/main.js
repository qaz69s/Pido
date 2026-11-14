/**
 * 应用入口：挂载 Pinia、Router 和全局样式
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './themes.css'
import './style.css'
import './animations.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 等路由解析完再挂载，避免首屏布局闪烁（如未配置时先闪一下主界面再跳 /setup）
router.isReady().then(() => app.mount('#app'))

// PWA：注册 Service Worker（仅生产构建；浏览器要求 HTTPS 或 localhost 才会生效）
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  })
}
