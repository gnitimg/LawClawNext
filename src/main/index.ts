/**
 * Electron main entry: boots the dsh web host, opens the desktop window, and
 * serves IPC for the renderer (dsh URL + plugin marketplace GitHub API).
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { basename, extname } from 'node:path'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import {
  startDshHost,
  syncLawClawSkills,
  type DshHostHandle,
  installPlugin,
  listInstalledPlugins,
  readDesktopEnv,
  resolveDshHome,
  setPluginEnabled,
  uninstallPlugin,
  writeDesktopEnv,
  type PluginMutation,
} from './dsh-host'
import { createDshApiProxy, type DshApiProxy } from './dsh-client'
import { httpFailureMessage } from './http-error'
import {
  DEFAULT_OCR_SETTINGS,
  benchmarkOcr,
  inspectOcrCapabilities,
  installOcrGpuAcceleration,
  invokeCloudOcr,
  normalizeOcrSettings,
  provisionOcrRuntime,
  type OcrSettings,
} from './ocr-service'
import { readMcpServers, testMcpServer, writeMcpServers } from './mcp-config'
import { readModelProviders, testModelProvider, testProviderModel, writeModelProviders } from './model-providers'
import { normalizeAgents, type LawClawAgent } from './agent-runtime'
import {
  DEFAULT_ENABLED_SKILL_IDS,
  discoverLawClawSkills,
  type LawClawSkill,
} from './skill-catalog'

const here = dirname(fileURLToPath(import.meta.url))

let host: DshHostHandle | undefined
let proxy: DshApiProxy | undefined
let mainWindow: BrowserWindow | undefined
let isQuitting = false
let isRestartingHost = false
let pluginMutationQueue: Promise<void> = Promise.resolve()
let modelRuntimeReloadTimer: ReturnType<typeof setTimeout> | undefined
let pendingRuntimeScopes = new Set<'models' | 'agents'>()

interface RuntimeConfigStatus {
  status: 'idle' | 'applying' | 'applied' | 'error'
  scopes: Array<'models' | 'agents'>
  message: string
  updatedAt: number
}

let runtimeConfigStatus: RuntimeConfigStatus = {
  status: 'idle',
  scopes: [],
  message: '',
  updatedAt: Date.now(),
}

interface LawClawConfig {
  version: 2
  enabledSkills: string[]
  agents: LawClawAgent[]
  ocr: OcrSettings
}

let skillCatalogCache: LawClawSkill[] | undefined

function lawclawConfigPath(): string {
  return join(app.getPath('userData'), 'lawclaw-next.json')
}

function normalizedAgents(value: unknown): LawClawAgent[] {
  let providers: ReturnType<typeof readModelProviders> = []
  try { providers = readModelProviders() } catch {}
  return normalizeAgents(value, new Set(lawClawSkills().map((skill) => skill.id)), providers)
}

function readLawClawConfig(): LawClawConfig {
  const fallback: LawClawConfig = {
    version: 2,
    enabledSkills: DEFAULT_ENABLED_SKILL_IDS.filter((id) => lawClawSkills().some((skill) => skill.id === id)),
    agents: normalizedAgents(undefined),
    ocr: DEFAULT_OCR_SETTINGS,
  }
  try {
    const parsed = JSON.parse(readFileSync(lawclawConfigPath(), 'utf8')) as Partial<LawClawConfig> & { version?: number }
    const knownSkills = new Set(lawClawSkills().map((skill) => skill.id))
    const storedSkills = Array.isArray(parsed.enabledSkills)
      ? parsed.enabledSkills.filter((id): id is string => typeof id === 'string' && knownSkills.has(id))
      : fallback.enabledSkills
    const enabledSkills = parsed.version === 2
      ? storedSkills
      : [...new Set([...storedSkills, ...fallback.enabledSkills])]
    return {
      version: 2,
      enabledSkills,
      agents: normalizedAgents(parsed.agents),
      ocr: normalizeOcrSettings(parsed.ocr),
    }
  } catch {
    return fallback
  }
}

function syncOcrRuntimeSettings(settings: OcrSettings): void {
  const target = join(resolveDshHome(), 'ocr-settings.json')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify({
    gpuEnabled: settings.gpuEnabled,
    threads: settings.threads,
    dpi: settings.dpi,
    memoryLimitMb: settings.memoryLimitMb,
  }, null, 2) + '\n', 'utf8')
}

function desktopRoot(): string {
  return resolve(here, '../..')
}

function lawClawResourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : desktopRoot()
}

function lawClawContentRoot(): string {
  return app.isPackaged
    ? resolve(process.resourcesPath, 'lawclaw')
    : resolve(desktopRoot(), 'resources/lawclaw')
}

function lawClawSkills(): LawClawSkill[] {
  skillCatalogCache ??= discoverLawClawSkills(lawClawContentRoot())
  return skillCatalogCache
}

function writeLawClawConfig(config: LawClawConfig): void {
  const destination = lawclawConfigPath()
  const temporary = destination + '.tmp'
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', 'utf8')
  renameSync(temporary, destination)
}

function listLawClawSkills(): Array<LawClawSkill & { enabled: boolean }> {
  const enabled = new Set(readLawClawConfig().enabledSkills)
  return lawClawSkills().map((skill) => ({ ...skill, entrypoints: [...skill.entrypoints], compatibleAgents: [...skill.compatibleAgents], enabled: enabled.has(skill.id) }))
}

function queuePluginMutation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = pluginMutationQueue.then(operation, operation)
  pluginMutationQueue = pending.then(() => {}, () => {})
  return pending
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function currentDshUrl(): Promise<string> {
  return host?.url ?? await restartDshHost()
}

async function applyPluginMutation(
  operation: () => Promise<PluginMutation>,
  rollback: (mutation: PluginMutation) => Promise<void>,
): Promise<PluginMutation & { dshUrl: string }> {
  const mutation = await operation()
  try {
    const dshUrl = await restartDshHost()
    return { ...mutation, dshUrl }
  } catch (error) {
    try {
      await rollback(mutation)
      await restartDshHost()
    } catch (recoveryError) {
      throw new Error(
        '插件加载失败，且自动回滚未能恢复 DSH。原始错误：' + errorMessage(error) +
        '；恢复错误：' + errorMessage(recoveryError),
      )
    }
    throw new Error('插件未能加载，已自动回滚到之前的配置：' + errorMessage(error))
  }
}

async function uninstallPluginSafely(name: string): Promise<PluginMutation & { dshUrl: string }> {
  const installed = listInstalledPlugins().find((plugin) => plugin.name === name)
  if (installed === undefined) throw new Error('插件未安装：' + name)

  if (installed.enabled) {
    await applyPluginMutation(
      () => setPluginEnabled(name, false),
      async () => { await setPluginEnabled(name, true) },
    )
  }

  try {
    const mutation = await uninstallPlugin(name)
    return { ...mutation, dshUrl: await currentDshUrl() }
  } catch (error) {
    if (installed.enabled) {
      try {
        await setPluginEnabled(name, true)
        await restartDshHost()
      } catch (recoveryError) {
        throw new Error(
          '插件卸载失败，且未能恢复原启用状态。原始错误：' + errorMessage(error) +
          '；恢复错误：' + errorMessage(recoveryError),
        )
      }
      throw new Error('插件卸载失败，已恢复原启用状态：' + errorMessage(error))
    }
    throw error
  }
}

function assertGithubPluginSpec(spec: string): void {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(spec)) throw new Error('插件来源必须是有效的 GitHub owner/repository')
}

function syncWindowChrome(): void {
  const dark = nativeTheme.shouldUseDarkColors
  mainWindow?.setBackgroundColor(dark ? '#1c1d1b' : '#fbfaf8')
  mainWindow?.setTitleBarOverlay({
    color: dark ? '#1c1d1b' : '#fbfaf8',
    symbolColor: dark ? '#e9e8e2' : '#292b29',
    height: 48,
  })
}

function observeHostExit(current: DshHostHandle): void {
  current.child.on('exit', (code, signal) => {
    if (isQuitting || isRestartingHost || current !== host) return
    proxy?.dispose()
    proxy = undefined
    host = undefined
    void restartDshHost().catch((error: unknown) => {
      dialog.showErrorBox(
        'LawClaw 服务恢复失败',
        `后台服务意外停止（code=${String(code)}，signal=${String(signal)}），自动恢复未成功。\n\n${errorMessage(error)}\n\n请保留当前窗口并重新启动 LawClaw Next；案件数据不会因此删除。`,
      )
    })
  })
}

async function restartDshHost(): Promise<string> {
  isRestartingHost = true
  const previousHost = host
  proxy?.dispose()
  proxy = undefined
  host = undefined
  await previousHost?.stop().catch(() => {})
  try {
    const nextHost = await startDshHost()
    host = nextHost
    try {
      const nextProxy = await createDshApiProxy(nextHost.url, (frame) => { mainWindow?.webContents.send('dsh:stream:frame', frame) })
      proxy = nextProxy
      observeHostExit(nextHost)
      mainWindow?.webContents.send('dsh:host-restarted', nextHost.url)
      return nextHost.url
    } catch (error) {
      host = undefined
      await nextHost.stop().catch(() => {})
      throw error
    }
  } finally {
    isRestartingHost = false
  }
}

function publishRuntimeConfigStatus(next: RuntimeConfigStatus): void {
  runtimeConfigStatus = next
  mainWindow?.webContents.send('runtime:config-status', next)
}

function scheduleRuntimeReload(scope: 'models' | 'agents'): void {
  pendingRuntimeScopes.add(scope)
  publishRuntimeConfigStatus({
    status: 'applying',
    scopes: [...pendingRuntimeScopes],
    message: '正在应用配置…',
    updatedAt: Date.now(),
  })
  if (modelRuntimeReloadTimer !== undefined) clearTimeout(modelRuntimeReloadTimer)
  modelRuntimeReloadTimer = setTimeout(() => {
    modelRuntimeReloadTimer = undefined
    const scopes = [...pendingRuntimeScopes]
    pendingRuntimeScopes = new Set()
    void queuePluginMutation(async () => {
      await restartDshHost()
      publishRuntimeConfigStatus({ status: 'applied', scopes, message: '配置已应用', updatedAt: Date.now() })
    }).catch((error: unknown) => {
      console.error('Unable to reload model provider configuration:', error)
      publishRuntimeConfigStatus({ status: 'error', scopes, message: `配置应用失败：${errorMessage(error)}`, updatedAt: Date.now() })
    })
  }, 500)
}

/** Fetch the live plugin list from GitHub topic dsh-plugin (server-side, no CORS). */
async function fetchPlugins(): Promise<unknown> {
  const url = 'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=100'
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'deepseek-desktop' } })
  if (!response.ok) throw new Error(`GitHub API ${String(response.status)} ${response.statusText}`)
  return response.json()
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 8_000 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolveP(stdout.trim())
    })
  })
}

async function readProjectEnvironment(path: string): Promise<unknown> {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('项目目录不存在或不可读取')
  try {
    const [branch, branchOutput, porcelain, worktreeOutput] = await Promise.all([
      runGit(path, ['branch', '--show-current']),
      runGit(path, ['branch', '--format=%(refname:short)']),
      runGit(path, ['status', '--short', '--untracked-files=normal']),
      runGit(path, ['worktree', 'list', '--porcelain']),
    ])
    const changes = porcelain === '' ? [] : porcelain.split(/\r?\n/).map((line) => ({
      status: line.slice(0, 2).trim() || '?',
      path: line.slice(3).trim(),
    }))
    const branches = branchOutput === '' ? [] : branchOutput.split(/\r?\n/).filter(Boolean)
    const worktrees: Array<{ path: string, branch?: string, head?: string }> = []
    let current: { path: string, branch?: string, head?: string } | undefined
    for (const line of worktreeOutput.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice(9) }
        worktrees.push(current)
      } else if (current !== undefined && line.startsWith('branch ')) {
        current.branch = line.slice(7).replace(/^refs\/heads\//, '')
      } else if (current !== undefined && line.startsWith('HEAD ')) {
        current.head = line.slice(5, 12)
      }
    }
    return { path, isGit: true, branch: branch || 'HEAD', branches, changes, worktrees }
  } catch {
    return { path, isGit: false, branches: [], changes: [], worktrees: [] }
  }
}

function openProjectTerminal(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('项目目录不存在或不可读取')
  const child = spawn('powershell.exe', ['-NoExit', '-Command', 'Set-Location -LiteralPath $args[0]', path], {
    cwd: path,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'LawClaw Next',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f7f4',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f7f7f4',
      symbolColor: '#292b29',
      height: 48,
    },
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  const revealWindow = (): void => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }
  mainWindow.once('ready-to-show', revealWindow)
  mainWindow.webContents.once('did-finish-load', revealWindow)
  mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
    revealWindow()
    dialog.showErrorBox('LawClaw Next', `界面加载失败（${String(code)}）：${description}`)
  })
  const revealFallback = setTimeout(revealWindow, 5_000)
  mainWindow.once('closed', () => clearTimeout(revealFallback))
  syncWindowChrome()
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://127.0.0.1:') || target.startsWith('https://127.0.0.1:')) return { action: 'allow' }
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl !== undefined) void mainWindow.loadURL(rendererUrl)
  else void mainWindow.loadFile(join(here, '../renderer/index.html'))
}

async function bootstrap(): Promise<void> {
  try {
    const lawClawConfig = readLawClawConfig()
    syncLawClawSkills(lawClawConfig.enabledSkills)
    syncOcrRuntimeSettings(lawClawConfig.ocr)
    host = await startDshHost()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('LawClaw Next 启动失败', `无法启动案件分析服务。\n\n${message}\n\n请重新安装完整的 LawClaw Next；已有案件数据不会被删除。`)
    app.quit()
    return
  }

  observeHostExit(host)

  try {
    proxy = await createDshApiProxy(host.url, (frame) => { mainWindow?.webContents.send('dsh:stream:frame', frame) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('LawClaw Next', `Failed to authenticate with the dsh host.\n\n${message}`)
    void shutdown()
    return
  }

  ipcMain.handle('dsh:url', () => host?.url)
  ipcMain.handle('dsh:rpc', (_event, method: string, args: unknown) => proxy?.rpc(method, args))
  ipcMain.handle('dsh:stream:open', (_event, endpoint: string, args: unknown) => proxy?.openStream(endpoint, args))
  ipcMain.handle('dsh:stream:cancel', (_event, streamId: string) => { proxy?.cancelStream(streamId) })
  ipcMain.handle('plugins:list', () => fetchPlugins())
  ipcMain.handle('plugins:installed', () => listInstalledPlugins())
  ipcMain.handle('plugins:install', (_event, spec: string) => {
    assertGithubPluginSpec(spec)
    return queuePluginMutation(async () => {
      const before = new Map(listInstalledPlugins().map((plugin) => [plugin.name, plugin]))
      return await applyPluginMutation(
        () => installPlugin(spec),
        async (mutation) => {
          const plugin = mutation.plugin
          if (plugin === undefined) return
          const previous = before.get(plugin.name)
          if (previous === undefined) await uninstallPlugin(plugin.name)
          else await setPluginEnabled(plugin.name, previous.enabled)
        },
      )
    })
  })
  ipcMain.handle('plugins:set-enabled', (_event, name: string, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('插件启用状态无效')
    return queuePluginMutation(async () => {
      const previous = listInstalledPlugins().find((plugin) => plugin.name === name)
      if (previous === undefined) throw new Error('插件未安装：' + name)
      const mutation = await setPluginEnabled(name, enabled)
      if (previous.enabled === enabled) return { ...mutation, dshUrl: await currentDshUrl() }
      return await applyPluginMutation(
        async () => mutation,
        async () => { await setPluginEnabled(name, previous.enabled) },
      )
    })
  })
  ipcMain.handle('plugins:uninstall', (_event, name: string) => {
    return queuePluginMutation(() => uninstallPluginSafely(name))
  })
  ipcMain.handle('skills:list', () => listLawClawSkills())
  ipcMain.handle('skills:set-enabled', (_event, id: string, enabled: boolean) => {
    if (typeof id !== 'string' || !lawClawSkills().some((skill) => skill.id === id)) throw new Error('未知技能：' + String(id))
    if (typeof enabled !== 'boolean') throw new Error('技能启用状态无效')
    const config = readLawClawConfig()
    const selected = new Set(config.enabledSkills)
    if (enabled) selected.add(id)
    else selected.delete(id)
    writeLawClawConfig({ ...config, enabledSkills: [...selected] })
    syncLawClawSkills([...selected])
    return listLawClawSkills()
  })
  ipcMain.handle('agents:list', () => readLawClawConfig().agents)
  ipcMain.handle('agents:save', (_event, agents: unknown) => {
    const config = readLawClawConfig()
    const normalized = normalizedAgents(agents)
    writeLawClawConfig({ ...config, agents: normalized })
    scheduleRuntimeReload('agents')
    return normalized
  })
  ipcMain.handle('mcp:read', () => readMcpServers())
  ipcMain.handle('mcp:test', async (_event, server: unknown) => await testMcpServer(server))
  ipcMain.handle('mcp:save', async (_event, value: unknown) => {
    const previous = readMcpServers()
    const servers = writeMcpServers(value)
    try {
      await restartDshHost()
      return servers
    } catch (error) {
      writeMcpServers(previous)
      await restartDshHost().catch(() => {})
      throw error
    }
  })
  ipcMain.handle('models:providers:read', () => readModelProviders())
  ipcMain.handle('models:providers:test', async (_event, provider: unknown) => await testModelProvider(provider))
  ipcMain.handle('models:providers:test-model', async (_event, provider: unknown, modelId: unknown) => await testProviderModel(provider, modelId))
  ipcMain.handle('models:providers:save', async (_event, value: unknown) => {
    const providers = writeModelProviders(value)
    scheduleRuntimeReload('models')
    return providers
  })
  ipcMain.handle('runtime:config-status', () => runtimeConfigStatus)
  ipcMain.handle('runtime:restart', () => queuePluginMutation(async () => restartDshHost()))
  ipcMain.handle('ocr:read', () => readLawClawConfig().ocr)
  ipcMain.handle('ocr:save', (_event, value: unknown) => {
    const config = readLawClawConfig()
    const ocr = normalizeOcrSettings(value)
    writeLawClawConfig({ ...config, ocr })
    syncOcrRuntimeSettings(ocr)
    return ocr
  })
  ipcMain.handle('ocr:capabilities', async () => {
    const settings = readLawClawConfig().ocr
    return await inspectOcrCapabilities(settings, desktopRoot(), lawClawResourcesRoot())
  })
  ipcMain.handle('ocr:install-gpu', async () => {
    return await installOcrGpuAcceleration(readLawClawConfig().ocr, desktopRoot(), lawClawResourcesRoot())
  })
  ipcMain.handle('ocr:provision', async () => {
    return await provisionOcrRuntime(readLawClawConfig().ocr, desktopRoot(), lawClawResourcesRoot())
  })
  ipcMain.handle('ocr:choose-benchmark-file', async () => {
    if (mainWindow === undefined) return undefined
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择一份扫描材料测速',
      buttonLabel: '开始本地测速',
      filters: [{ name: '案件材料', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('ocr:benchmark', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !existsSync(filePath) || !statSync(filePath).isFile()) throw new Error('测速材料不存在或不可读取。')
    const settings = readLawClawConfig().ocr
    return await benchmarkOcr(settings, filePath, desktopRoot(), lawClawResourcesRoot())
  })
  ipcMain.handle('ocr:choose-cloud-file', async () => {
    if (mainWindow === undefined) return undefined
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择一份材料测试云端 OCR',
      buttonLabel: '选择材料',
      filters: [{ name: '案件材料', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('ocr:cloud-test', async (_event, filePath: string, explicitlyAuthorized: boolean) => {
    if (explicitlyAuthorized !== true) throw new Error('未取得本次上传授权，材料不会发送。')
    if (typeof filePath !== 'string' || !existsSync(filePath) || !statSync(filePath).isFile()) throw new Error('云端 OCR 材料不存在或不可读取。')
    return await invokeCloudOcr(readLawClawConfig().ocr, filePath)
  })
  ipcMain.handle('settings:read', () => readDesktopEnv())
  ipcMain.handle('settings:write', async (_event, env: Record<string, string>) => {
    const previous = readDesktopEnv()
    writeDesktopEnv(env)
    try {
      return await restartDshHost()
    } catch (error) {
      writeDesktopEnv(previous)
      await restartDshHost().catch(() => {})
      throw error
    }
  })
  ipcMain.handle('settings:appearance', (_event, appearance: string) => {
    if (appearance !== 'light' && appearance !== 'dark' && appearance !== 'system') return
    nativeTheme.themeSource = appearance
    syncWindowChrome()
  })
  ipcMain.handle('models:fetch', async (_event, baseUrl: string, apiKey: string) => {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
    if (!response.ok) throw new Error(httpFailureMessage('拉取模型失败', response.status, response.statusText, await response.text().catch(() => '')))
    const json = (await response.json()) as { data?: Array<{ id: string }> }
    return json.data?.map((model) => model.id).filter((id) => id !== '') ?? []
  })
  ipcMain.handle('project:choose-directory', async () => {
    if (mainWindow === undefined) return undefined
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择案件材料目录',
      buttonLabel: '添加到 LawClaw',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('project:environment', (_event, path: string) => readProjectEnvironment(path))
  ipcMain.handle('project:open-terminal', (_event, path: string) => { openProjectTerminal(path) })
  ipcMain.handle('attachments:choose-images', async () => {
    if (mainWindow === undefined) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加案件图片材料',
      buttonLabel: '添加到当前分析',
      filters: [{ name: '图片材料', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return []
    return result.filePaths.slice(0, 20).map((path) => {
      const data = readFileSync(path)
      if (data.byteLength > 5 * 1024 * 1024) throw new Error(`${basename(path)} 超过 5 MB 附件限制`)
      const extension = extname(path).toLowerCase()
      const mediaType = extension === '.png' ? 'image/png'
        : extension === '.webp' ? 'image/webp'
          : extension === '.gif' ? 'image/gif' : 'image/jpeg'
      return { name: basename(path), mediaType, data: data.toString('base64') }
    })
  })

  createWindow()
}

async function shutdown(): Promise<void> {
  if (isQuitting) return
  isQuitting = true
  proxy?.dispose()
  await host?.stop().catch(() => {})
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => { void shutdown() })
  app.on('before-quit', () => { isQuitting = true })
  void app.whenReady().then(() => {
    nativeTheme.on('updated', syncWindowChrome)
    return bootstrap()
  })
}
