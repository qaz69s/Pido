# Pido

简约的 mihomo (Clash.Meta) Web 管理面板，Vue 3 + Vite + TailwindCSS 编写。

## 功能
- 概览：实时上下行曲线、内存、连接数、累计流量、运行信息
- 代理：代理组图标（proxy-groups 的 icon，支持图片地址 / data URI / svg 代码）、代理组切换、单点 / 整组 / 全部测速、proxy-providers 更新与健康检查
- 连接：实时列表与速率、搜索（多关键词）、排序、暂停、断开单条 / 筛选结果 / 全部、详情、已关闭记录
- 规则：规则列表（搜索、按目标筛选、长列表分批渲染）、rule-providers 更新
- 日志：级别切换、搜索、暂停缓存、导出 txt（切换页面不丢失）
- 配置：运行模式、端口、局域网 / IPv6 / 嗅探 / TCP 并发、日志级别、TUN（含 Mips 栈）、在线更新面板 / 内核（Release / Alpha）、重载配置、更新 GEO、清缓存、重启内核、主题与后端切换

> 配置页的修改通过 `PATCH /configs` 生效，只作用于当前运行的内核，重启或重载后恢复为配置文件中的值。

## 主题配色
配置页「面板 → 配色」可切换 6 套配色，每套都有浅色和深色，跟随「外观」里的系统 / 浅色 / 深色设置：

| 配色 | 风格 |
| --- | --- |
| 靛夜（默认） | 沉稳的靛蓝 |
| 北境 | Nord 冷色调，低饱和护眼 |
| 素墨 | 纯中性灰，黑白极简（参考 zashboard dark-neutral） |
| 樱花 | 粉紫双光晕，最圆润 |
| 赛博 | 霓虹色、等宽字体、网格底纹、直角 |
| 暖阳 | 暖橙与米色 |

实现方式：`tailwind.config.js` 中的 `slate`（中性色）、`brand`（主色）、`accent`（强调色）和圆角都指向 CSS 变量，变量在 `src/themes.css` 里按 `<html data-theme="...">` 定义。新增配色只需在 `themes.css` 加一组变量，并在 `src/utils/themes.js` 登记。

## 运行（开发）
```bash
npm install
npm run dev            # 默认 http://localhost:5173，局域网设备可用 http://<电脑IP>:5173
```
- 直接连接：在设置页填 `http://127.0.0.1:9090` + secret
- 遇到 CORS：点「使用开发代理」（地址变为 `http://localhost:5173/mihomo`），由 Vite 转发
- 代理目标默认 `http://127.0.0.1:9090`，修改：`MIHOMO_TARGET=http://192.168.1.2:9090 npm run dev`，或写进 `.env.local`

## 构建
```bash
npm run build          # 产物在 dist/
npm run preview        # 本地预览构建结果
```

## 放进 external-ui
```yaml
external-controller: 0.0.0.0:9090   # 仅本机用可写 127.0.0.1:9090
secret: your-secret
external-ui: ui                     # 相对 mihomo 工作目录（-d 指定的目录）
```
1. 把 `dist/` 里的所有文件复制到 `<mihomo 工作目录>/ui/`（index.html 要在 ui/ 根下）
2. 重启 mihomo（或重载配置）
3. 访问 `http://<后端地址>:9090/ui/`，后端地址会自动预填为当前站点，只需填 secret

## 下载

稳定下载地址（始终是最新版）：

| 用途 | 地址 |
| --- | --- |
| 最新 Release（推荐） | `https://github.com/qaz69s/Pido/releases/latest/download/dist.zip` |
| gh-pages 分支（跟随 main） | `https://github.com/qaz69s/Pido/archive/refs/heads/gh-pages.zip` |

修改 `package.json` 的 `version` 并推送到 `main`，GitHub Actions 会自动构建、发布 gh-pages，并创建对应的 Release。

## 在线更新

「配置 → 更新」里可以：

- **更新面板**：调用 `POST /upgrade/ui`，内核下载 `external-ui-url` 指向的压缩包并覆盖面板目录。在 mihomo 配置里加上：
  ```yaml
  external-ui: ui
  external-ui-name: pido        # 可选：放到 ui/pido 子目录，访问 /ui/pido/
  external-ui-url: https://github.com/qaz69s/Pido/releases/latest/download/dist.zip
  ```
  不设置的话，内核会下载它自带的默认面板（MetaCubeXD）。
- **升级 mihomo 内核**：可选 **Release**（正式版）或 **Alpha**（预览版），调用 `POST /upgrade?channel=release|alpha`。内核会从 GitHub 下载新版本、替换自身并自动重启，面板会等它恢复后提示新版本号；已是最新时可选择强制重装。嵌入模式下内核不支持升级。
- 「最新版本」直接从浏览器请求 GitHub 获取，网络不通时只是不显示，不影响升级。

## 目录结构
```
src/
  api/          http.js（请求与错误归一）ws.js（自动重连）proxies / connections / rules / configs
  stores/       backend（后端地址与 secret）theme toast confirm
  composables/  useStream（订阅 WebSocket）useInfiniteList（长列表分批渲染）
  components/   common（Icon Modal Switch …）layout charts proxy connection
  views/        Setup Overview Proxies Connections Rules Logs Config
  utils/        format storage connection themes（配色列表）
themes.css      各配色的 CSS 变量
```
