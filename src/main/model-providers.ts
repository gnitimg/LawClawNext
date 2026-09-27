import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { httpFailureMessage, isAbortError } from './http-error'

export type ModelApiFormat = 'openai-completions' | 'anthropic-messages'

export interface DesktopModelEntry {
  id: string
  name: string
  enabled: boolean
  contextWindow: number
  maxTokens: number
  vision: boolean
}

export interface DesktopModelProvider {
  id: string
  route: string
  name: string
  enabled: boolean
  apiFormat: ModelApiFormat
  baseUrl: string
  apiKey: string
  models: DesktopModelEntry[]
}

export interface ModelProviderTestResult {
  message: string
  models: Array<{ id: string, name: string, vision?: boolean }>
}

export interface ModelTestResult { message: string }

const ROUTE = /^[A-Za-z0-9_-]{1,48}$/u

function providersPath(): string {
  return resolve(app.getPath('userData'), 'model-providers.enc')
}

function legacyDesktopEnvPath(): string {
  return app.isPackaged
    ? resolve(app.getPath('userData'), 'dsh/desktop.env')
    : resolve(app.getAppPath(), '.dsh-home/desktop.env')
}

function legacyModelSelection(): { provider?: string, model?: string } {
  const path = app.isPackaged
    ? resolve(app.getPath('userData'), 'dsh/settings.yaml')
    : resolve(app.getAppPath(), '.dsh-home/settings.yaml')
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  const provider = /^\s{2}provider:\s*([^\s#]+)\s*$/mu.exec(text)?.[1]
  const model = /^\s{2}model:\s*(.+?)\s*$/mu.exec(text)?.[1]
  return {
    ...(provider !== undefined && ROUTE.test(provider) ? { provider } : {}),
    ...(model !== undefined && model !== '' ? { model } : {}),
  }
}

function legacyProvider(): DesktopModelProvider | undefined {
  const path = legacyDesktopEnvPath()
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return undefined
  const env = Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return []
    const separator = trimmed.indexOf('=')
    if (separator <= 0) return []
    return [[trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]]
  }))
  const apiKey = env.DEEPSEEK_API_KEY
  const baseUrl = env.DEEPSEEK_BASE_URL
  if (apiKey === undefined || apiKey === '' || baseUrl === undefined || baseUrl === '') return undefined
  const dashscope = /dashscope\.aliyuncs\.com/iu.test(baseUrl)
  const deepseek = /(?:^|\.)deepseek\.com/iu.test(new URL(baseUrl).hostname)
  const selection = legacyModelSelection()
  return normalizeModelProvider({
    id: 'legacy-desktop-provider',
    route: selection.provider ?? (dashscope ? 'aliyun' : deepseek ? 'deepseek' : 'legacy-provider'),
    name: dashscope ? '阿里云百炼' : deepseek ? 'DeepSeek' : '旧版模型服务',
    enabled: true,
    apiFormat: 'openai-completions',
    baseUrl,
    apiKey,
    models: selection.model === undefined ? [] : [{
      id: selection.model,
      name: selection.model,
      enabled: true,
      contextWindow: 128_000,
      maxTokens: 8_192,
      vision: likelyVisionModel(selection.model, selection.model),
    }],
  })
}

function cleanUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/u, '') : ''
  if (text === '') throw new Error('请填写 Base URL。')
  const url = new URL(text)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('模型服务必须使用 HTTPS；只有本机地址可以使用 HTTP。')
  }
  return text
}

function positiveInt(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback
}

export function normalizeModelProvider(value: unknown): DesktopModelProvider {
  const source = typeof value === 'object' && value !== null ? value as Partial<DesktopModelProvider> : {}
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : randomUUID()
  const route = typeof source.route === 'string' && source.route !== '' ? source.route.trim() : `lawclaw-${id.slice(0, 8)}`
  if (!ROUTE.test(route)) throw new Error('提供商标识只能使用字母、数字、短横线或下划线。')
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (name === '') throw new Error('请填写提供商名称。')
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : ''
  if (apiKey === '') throw new Error(`提供商“${name}”缺少 API Key。`)
  const models = Array.isArray(source.models) ? source.models.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const model = item as Partial<DesktopModelEntry>
    const modelId = typeof model.id === 'string' ? model.id.trim() : ''
    if (modelId === '') return []
    return [{
      id: modelId,
      name: typeof model.name === 'string' && model.name.trim() !== '' ? model.name.trim() : modelId,
      enabled: model.enabled !== false,
      contextWindow: positiveInt(model.contextWindow, 128_000),
      maxTokens: positiveInt(model.maxTokens, 8_192),
      vision: model.vision === true,
    }]
  }) : []
  return {
    id,
    route,
    name,
    enabled: source.enabled !== false,
    apiFormat: source.apiFormat === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions',
    baseUrl: cleanUrl(source.baseUrl),
    apiKey,
    models,
  }
}

export function normalizeModelProviders(value: unknown): DesktopModelProvider[] {
  if (!Array.isArray(value)) return []
  const providers = value.map(normalizeModelProvider)
  const routes = new Set<string>()
  for (const provider of providers) {
    if (routes.has(provider.route)) throw new Error(`提供商标识重复：${provider.route}`)
    routes.add(provider.route)
  }
  return providers
}

export function readModelProviders(): DesktopModelProvider[] {
  const path = providersPath()
  if (!existsSync(path)) {
    const migrated = legacyProvider()
    if (migrated === undefined) return []
    const encrypted = safeStorage.encryptString(JSON.stringify([migrated]))
    writeFileSync(path, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 })
    return [migrated]
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，无法读取模型凭据。')
  const plaintext = safeStorage.decryptString(Buffer.from(readFileSync(path, 'utf8'), 'base64'))
  const providers = normalizeModelProviders(JSON.parse(plaintext) as unknown)
  const legacy = providers.find((provider) => provider.id === 'legacy-desktop-provider' && provider.models.length === 0)
  const selection = legacyModelSelection()
  if (legacy === undefined || selection.model === undefined) return providers
  const migrated = providers.map((provider) => provider.id !== legacy.id ? provider : {
    ...provider,
    route: selection.provider ?? provider.route,
    models: [{
      id: selection.model!,
      name: selection.model!,
      enabled: true,
      contextWindow: 128_000,
      maxTokens: 8_192,
      vision: likelyVisionModel(selection.model!, selection.model!),
    }],
  })
  const encrypted = safeStorage.encryptString(JSON.stringify(migrated))
  writeFileSync(path, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 })
  return migrated
}

export function writeModelProviders(value: unknown): DesktopModelProvider[] {
  const providers = normalizeModelProviders(value)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，模型凭据未保存。')
  const encrypted = safeStorage.encryptString(JSON.stringify(providers))
  writeFileSync(providersPath(), encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 })
  return providers
}

function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/models`
}

function likelyVisionModel(id: string, name: string, metadata?: Record<string, unknown>): boolean {
  const architecture = typeof metadata?.architecture === 'object' && metadata.architecture !== null
    ? metadata.architecture as Record<string, unknown>
    : undefined
  const modalities = [metadata?.input_modalities, metadata?.modalities, architecture?.input_modalities]
    .flatMap((value) => Array.isArray(value) ? value : [])
  const capabilities = typeof metadata?.capabilities === 'object' && metadata.capabilities !== null
    ? metadata.capabilities as Record<string, unknown>
    : undefined
  if (modalities.some((value) => typeof value === 'string' && /image|vision/iu.test(value))) return true
  if (capabilities?.vision === true || metadata?.vision === true) return true
  return /(^|[-_/.])(vision|vl|omni|gpt-4o|image|multimodal|pixtral|llava|minicpm-v|glm-\d+v)([-_/.]|$)/iu.test(`${id} ${name}`)
}

export async function testModelProvider(value: unknown): Promise<ModelProviderTestResult> {
  const provider = normalizeModelProvider(value)
  const headers: Record<string, string> = provider.apiFormat === 'anthropic-messages'
    ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', Accept: 'application/json' }
    : { Authorization: `Bearer ${provider.apiKey}`, Accept: 'application/json' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    let response: Response
    try {
      response = await fetch(modelsEndpoint(provider.baseUrl), { headers, signal: controller.signal })
    } catch (error) {
      if (isAbortError(error)) throw new Error('连接超时：服务商长时间没有响应，请检查网络后重试。')
      throw error
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(httpFailureMessage('连接失败', response.status, response.statusText, detail))
    }
    const json = await response.json() as { data?: Array<Record<string, unknown>> }
    const models = (json.data ?? []).flatMap((model) => {
      if (typeof model.id !== 'string' || model.id === '') return []
      const name = typeof model.display_name === 'string' ? model.display_name : typeof model.name === 'string' ? model.name : model.id
      return [{ id: model.id, name, vision: likelyVisionModel(model.id, name, model) }]
    })
    return { message: models.length === 0 ? '连接成功；服务未返回模型目录，可手动添加模型。' : `连接成功，发现 ${String(models.length)} 个模型。`, models }
  } finally {
    clearTimeout(timer)
  }
}

export async function testProviderModel(value: unknown, modelIdValue: unknown): Promise<ModelTestResult> {
  const provider = normalizeModelProvider(value)
  const modelId = typeof modelIdValue === 'string' ? modelIdValue.trim() : ''
  if (modelId === '') throw new Error('缺少要测试的模型 ID。')
  const anthropic = provider.apiFormat === 'anthropic-messages'
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    : { Authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' }
  const endpoint = `${provider.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`
  const body = anthropic
    ? { model: modelId, max_tokens: 8, messages: [{ role: 'user', content: '只回复 OK' }] }
    : { model: modelId, max_tokens: 8, stream: false, messages: [{ role: 'user', content: '只回复 OK' }] }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    let response: Response
    try {
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    } catch (error) {
      if (isAbortError(error)) throw new Error('连接超时：服务商长时间没有响应，请稍后再试。')
      throw error
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (/product is not activated|not activated products/iu.test(detail)) throw new Error('厂商账户尚未开通此模型，请先在厂商控制台开通后再启用。')
      throw new Error(httpFailureMessage('模型测试失败', response.status, response.statusText, detail))
    }
    return { message: `模型 ${modelId} 响应正常。` }
  } finally {
    clearTimeout(timer)
  }
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

export function writeModelRuntimePatch(dshHome: string, providers = readModelProviders()): { patchPath?: string, env: Record<string, string> } {
  const patchPath = resolve(dshHome, 'models.patch.yml')
  const enabled = providers.filter((provider) => provider.enabled && provider.models.some((model) => model.enabled))
  if (enabled.length === 0) {
    rmSync(patchPath, { force: true })
    return { env: {} }
  }
  const env: Record<string, string> = {}
  const lines = [
    '# Generated by LawClaw Next. API keys are injected through the child environment.',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
  ]
  enabled.forEach((provider, index) => {
    const envName = `LAWCLAW_MODEL_PROVIDER_${String(index)}_API_KEY`
    env[envName] = provider.apiKey
    lines.push(`      ${provider.route}:`)
    lines.push(`        displayName: ${yaml(provider.name)}`)
    lines.push(`        apiKeyEnv: ${yaml(envName)}`)
    lines.push(`        api: ${yaml(provider.apiFormat)}`)
    lines.push(`        baseURL: ${yaml(provider.baseUrl)}`)
    lines.push('        models:')
    provider.models.filter((model) => model.enabled).forEach((model) => {
      lines.push(`          - id: ${yaml(model.id)}`)
      lines.push(`            name: ${yaml(model.name)}`)
      lines.push(`            contextWindow: ${String(model.contextWindow)}`)
      lines.push(`            maxTokens: ${String(model.maxTokens)}`)
      lines.push(`            input: ${model.vision ? '[text, image]' : '[text]'}`)
    })
  })
  writeFileSync(patchPath, `${lines.join('\n')}\n`, 'utf8')
  return { patchPath, env }
}
