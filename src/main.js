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
