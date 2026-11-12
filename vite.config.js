import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

/** 面板版本号：取 package.json 的 version，与 GitHub Release 标签（v + 版本号）一致 */
function panelVersion() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
  return pkg.version
}

/**
 * Vite 配置
 * - base: './'  使用相对路径，构建产物可直接放进 mihomo 的 external-ui 目录（访问路径为 /ui/）
 * - server.proxy: 本地开发时把 /mihomo/* 转发到 mihomo 后端，绕过浏览器 CORS 限制
 *   目标地址可通过环境变量 MIHOMO_TARGET 修改，例如：
 *     MIHOMO_TARGET=http://192.168.1.2:9090 npm run dev
 *   或在项目根目录新建 .env.local 写入：MIHOMO_TARGET=http://192.168.1.2:9090
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.MIHOMO_TARGET || 'http://127.0.0.1:9090'

  return {
    base: './',
    plugins: [vue()],
    // 构建时注入：当前面板版本、GitHub 仓库（owner/name，用于检查更新；GitHub Actions 自动提供）
    define: {
      __PANEL_VERSION__: JSON.stringify(panelVersion()),
      __PANEL_REPO__: JSON.stringify(env.PANEL_REPO || process.env.GITHUB_REPOSITORY || 'qaz69s/Pido'),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: true, // 监听 0.0.0.0，手机可通过局域网 IP 访问开发服务器
      port: 5173,
      proxy: {
        // 在面板「后端地址」填 http://localhost:5173/mihomo（或点「使用开发代理」）即可
        '/mihomo': {
          target,
          changeOrigin: true,
          ws: true, // 同时代理 WebSocket（/traffic、/connections、/logs 等）
          rewrite: (path) => path.replace(/^\/mihomo/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  }
})
