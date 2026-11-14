/**
 * 当前内核图标：已连接时返回 mihomo / dae / honk 对应的 Logo，否则返回空（界面回退为 Pido 闪电图标）
 * - 手机端顶栏左上角与桌面端侧边栏 Logo 共用
 * - honk 暂无独立 Logo，使用 daeuniverse 组织图标
 */
import { computed } from 'vue'
import { useBackendStore } from '@/stores/backend'
import mihomoLogo from '@/assets/cores/mihomo.png'
import daeLogo from '@/assets/cores/dae.png'
import honkLogo from '@/assets/cores/honk.png'

const CORE_LOGOS = { mihomo: mihomoLogo, dae: daeLogo, honk: honkLogo }

export function useCoreLogo() {
  const backend = useBackendStore()
  return computed(() => {
    if (backend.status !== 'ok') return null
    const src = CORE_LOGOS[backend.engine]
    return src ? { src, name: backend.engine } : null
  })
}
