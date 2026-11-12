<script setup>
/**
 * 首次配置 / 修改后端
 * - 填写地址和 secret，点击「连接」时先测试，成功才保存
 * - 支持 URL 参数预填：#/setup?hostname=192.168.1.2&port=9090&secret=xxx
 * - 开发模式下可一键使用 Vite 代理，避开 CORS
 */
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBackendStore, guessDefaultUrl, DEFAULT_URL, DEV_PROXY_PATH } from '@/stores/backend'
import { useToastStore } from '@/stores/toast'
import { describeError } from '@/api/http'
import Icon from '@/components/common/Icon.vue'

const route = useRoute()
const router = useRouter()
const backend = useBackendStore()
const toast = useToastStore()
const isDev = import.meta.env.DEV

/** 初始值：URL 参数 > 已保存配置 > 推测默认值 */
function initialUrl() {
  const { hostname, port } = route.query
  if (hostname) return `http://${hostname}${port ? `:${port}` : ''}`
  return backend.url || guessDefaultUrl()
}

const form = reactive({
  url: initialUrl(),
  secret: typeof route.query.secret === 'string' ? route.query.secret : backend.secret,
})
const showSecret = ref(false)
const loading = ref(false)
const error = ref(null)
const errInfo = computed(() => (error.value ? describeError(error.value) : null))

async function submit() {
  loading.value = true
  error.value = null
  try {
    const v = await backend.save(form.url, form.secret.trim())
    toast.success(`连接成功：mihomo ${v?.version ?? ''}`)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    router.replace(redirect && !redirect.startsWith('/setup') ? redirect : '/overview')
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

function useDevProxy() {
  form.url = location.origin + DEV_PROXY_PATH
}

function clearConfig() {
  if (!confirm('确定清除已保存的后端配置吗？')) return
  backend.clear()
  form.url = DEFAULT_URL
  form.secret = ''
  error.value = null
  toast.info('已清除后端配置')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="mb-6 flex flex-col items-center text-center">
        <span class="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-on-brand shadow-lg shadow-brand-600/30">
          <Icon name="zap" class="h-6 w-6" />
        </span>
        <h1 class="text-xl font-semibold">Pido</h1>
        <p class="mt-1 text-sm text-slate-500">连接到你的 mihomo 内核</p>
        <p class="mt-0.5 text-xs text-slate-500">填写 external-controller 的地址和 secret</p>
      </div>

      <form class="card space-y-4 p-5" @submit.prevent="submit">
        <!-- 地址 -->
        <div>
          <label class="label" for="url">后端地址</label>
          <input
            id="url"
            v-model="form.url"
            class="input font-mono"
            placeholder="http://127.0.0.1:9090"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
            required
          />
          <button
            v-if="isDev"
            type="button"
            class="mt-1.5 text-xs text-brand-600 hover:underline dark:text-brand-400"
            @click="useDevProxy"
          >
            使用开发代理（{{ DEV_PROXY_PATH }} → vite.config.js 中的 MIHOMO_TARGET）
          </button>
        </div>

        <!-- Secret -->
        <div>
          <label class="label" for="secret">Secret</label>
          <div class="relative">
            <input
              id="secret"
              v-model="form.secret"
              :type="showSecret ? 'text' : 'password'"
              class="input pr-10 font-mono"
              placeholder="未设置可留空"
              autocomplete="current-password"
              autocapitalize="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600"
              :title="showSecret ? '隐藏' : '显示'"
              @click="showSecret = !showSecret"
            >
              <Icon :name="showSecret ? 'eyeOff' : 'eye'" class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="errInfo"
          class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200"
        >
          <div class="flex items-center gap-2 font-medium">
            <Icon name="alert" class="h-4 w-4 shrink-0" />
            {{ errInfo.title }}
          </div>
          <ul v-if="errInfo.tips.length" class="mt-2 list-disc space-y-1 pl-5 text-xs opacity-90">
            <li v-for="tip in errInfo.tips" :key="tip">{{ tip }}</li>
          </ul>
        </div>

        <button type="submit" class="btn-primary w-full py-2.5" :disabled="loading">
          <Icon v-if="loading" name="refresh" class="h-4 w-4 animate-spin" />
          {{ loading ? '正在连接…' : '连接' }}
        </button>

        <div v-if="backend.isConfigured" class="flex items-center justify-between pt-1 text-sm">
          <RouterLink to="/overview" class="text-slate-500 hover:underline">← 返回面板</RouterLink>
          <button type="button" class="text-rose-500 hover:underline" @click="clearConfig">清除配置</button>
        </div>
      </form>

      <p class="mt-4 text-center text-xs text-slate-400">配置仅保存在本机浏览器（localStorage）</p>
    </div>
  </div>
</template>
