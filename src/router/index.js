/**
 * 路由
 * - 使用 hash 模式：放进 external-ui（/ui/）后刷新页面也不会 404
 * - 守卫：未配置后端时一律跳转 /setup
 * - 概览页直接打包进主包（首屏），其余页面按需加载
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import { useBackendStore } from '@/stores/backend'
import OverviewView from '@/views/OverviewView.vue'

/**
 * 导航菜单（侧栏 / 底部导航共用）
 * - phone: false：不放进手机底部导航（底部最多 6 项，系统字体放大时也不换行）
 * - also：手机底部导航中这些路径也算作本项选中（DNS 在手机上并入「规则」，见 PhoneSectionSwitch.vue）
 */
export const navItems = [
  { path: '/overview', title: '概览', icon: 'chart' },
  { path: '/proxies', title: '代理', icon: 'globe' },
  { path: '/connections', title: '连接', icon: 'link' },
  { path: '/rules', title: '规则', icon: 'list', also: ['/dns'] },
  { path: '/dns', title: 'DNS', icon: 'compass', phone: false },
  { path: '/logs', title: '日志', icon: 'terminal' },
  { path: '/config', title: '配置', icon: 'sliders' },
]

const routes = [
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/views/SetupView.vue'),
    meta: { title: '连接后端', bare: true, public: true },
  },
  { path: '/', redirect: '/overview' },
  { path: '/overview', name: 'overview', component: OverviewView, meta: { title: '概览' } },
  {
    path: '/proxies',
    name: 'proxies',
    component: () => import('@/views/ProxiesView.vue'),
    meta: { title: '代理' },
  },
  {
    path: '/connections',
    name: 'connections',
    component: () => import('@/views/ConnectionsView.vue'),
    meta: { title: '连接' },
  },
  {
    path: '/rules',
    name: 'rules',
    component: () => import('@/views/RulesView.vue'),
    meta: { title: '规则' },
  },
  {
    path: '/dns',
    name: 'dns',
    component: () => import('@/views/DnsView.vue'),
    meta: { title: 'DNS' },
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('@/views/LogsView.vue'),
    meta: { title: '日志' },
  },
  {
    path: '/config',
    name: 'config',
    component: () => import('@/views/ConfigView.vue'),
    meta: { title: '配置' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/overview' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 切换页面时回到顶部
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const backend = useBackendStore()
  if (!to.meta.public && !backend.isConfigured) {
    return { name: 'setup', query: { redirect: to.fullPath } }
  }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Pido` : 'Pido'
})

export default router
