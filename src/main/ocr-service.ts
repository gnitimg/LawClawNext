import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { httpFailureMessage } from './http-error'

export interface OcrSettings {
  mode: 'local' | 'cloud'
  gpuEnabled: boolean
  pythonPath: string
  threads: number
  dpi: number
  memoryLimitMb: number
  cloudProvider: 'zai' | 'custom'
  cloudEndpoint: string
  cloudApiKey: string
  cloudModel: string
  termsUrl: string
  privacyUrl: string
}

export interface OcrCapabilities {
  ready: boolean
  pythonPath?: string
  providers: string[]
  gpuProvider?: string
  hardwareGpu?: string
  reason?: string
}

export interface OcrBenchmarkResult {
  status: 'good' | 'slow' | 'unavailable'
  pages: number
  sourcePages: number
  seconds: number
  secondsPerPage: number
  peakMemoryMb: number
  projectedMinutes100Pages: number
  projectedMinutes1000Pages: number
  provider: string
  gpuEnabled: boolean
  message: string
}

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  mode: 'local',
  gpuEnabled: false,
  pythonPath: '',
  threads: 2,
  dpi: 150,
  memoryLimitMb: 2048,
  cloudProvider: 'zai',
  cloudEndpoint: '',
  cloudApiKey: '',
  cloudModel: '',
  termsUrl: 'https://chat.z.ai/legal-agreement/terms-of-service',
  privacyUrl: 'https://chat.z.ai/legal-agreement/privacy-policy',
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}

function safeHttpsUrl(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (candidate === '') return fallback
  try {
    const url = new URL(candidate)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return url.toString()
  } catch {}
  return fallback
}

export function normalizeOcrSettings(value: unknown): OcrSettings {
  const source = typeof value === 'object' && value !== null ? value as Partial<OcrSettings> : {}
  const provider = source.cloudProvider === 'custom' ? 'custom' : 'zai'
  return {
    mode: source.mode === 'cloud' ? 'cloud' : 'local',
    gpuEnabled: source.gpuEnabled === true,
    pythonPath: typeof source.pythonPath === 'string' ? source.pythonPath.trim() : '',
    threads: boundedInteger(source.threads, DEFAULT_OCR_SETTINGS.threads, 1, 16),
    dpi: boundedInteger(source.dpi, DEFAULT_OCR_SETTINGS.dpi, 96, 300),
    memoryLimitMb: boundedInteger(source.memoryLimitMb, DEFAULT_OCR_SETTINGS.memoryLimitMb, 512, 16_384),
    cloudProvider: provider,
    cloudEndpoint: safeHttpsUrl(source.cloudEndpoint, provider === 'zai' ? DEFAULT_OCR_SETTINGS.cloudEndpoint : ''),
    cloudApiKey: typeof source.cloudApiKey === 'string' ? source.cloudApiKey.trim() : '',
    cloudModel: typeof source.cloudModel === 'string' ? source.cloudModel.trim() : '',
    termsUrl: safeHttpsUrl(source.termsUrl, provider === 'zai' ? DEFAULT_OCR_SETTINGS.termsUrl : ''),
    privacyUrl: safeHttpsUrl(source.privacyUrl, provider === 'zai' ? DEFAULT_OCR_SETTINGS.privacyUrl : ''),
  }
}

function execFileText(command: string, args: string[], timeout: number): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolveP, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(String(stderr || stdout || error.message).trim()))
        return
      }
      resolveP({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function pythonCandidates(pythonPathSetting: string, desktopRoot: string, resourcesPath: string): string[] {
  return [...new Set([
    pythonPathSetting,
    // Dev checkout first so iterating on the live env is never shadowed by a stale copy.
    resolve(desktopRoot, '.artifacts/ocr-env/Scripts/python.exe'),
    resolve(desktopRoot, 'resources/ocr-runtime/python.exe'),
    resolve(resourcesPath, 'ocr-runtime/python.exe'),
    'python.exe',
  ].filter(Boolean))]
}

/** Synchronous best guess at the app-provided OCR interpreter (existence checks
 * only, no process spawns) — surfaced to the agent runtime as LAWCLAW_OCR_PYTHON. */
export function resolveOcrPythonCandidate(pythonPathSetting: string, desktopRoot: string, resourcesPath: string): string | undefined {
  for (const command of pythonCandidates(pythonPathSetting, desktopRoot, resourcesPath)) {
    if (command.includes('\\') && !existsSync(command)) continue
    return command
  }
  return undefined
}

const PROVISION_PACKAGES = ['rapidocr-onnxruntime', 'pymupdf', 'onnxruntime-directml'] as const

/** Build a working local OCR environment from scratch: create a dedicated venv
 * next to the app artifacts and install the RapidOCR stack into it. Used by the
 * self-check repair so end users never hand-install OCR dependencies. */
export async function provisionOcrRuntime(settings: OcrSettings, desktopRoot: string, resourcesPath: string): Promise<{ pythonPath: string }> {
  const existing = await inspectOcrCapabilities(settings, desktopRoot, resourcesPath)
  if (existing.ready && existing.pythonPath !== undefined) return { pythonPath: existing.pythonPath }

  const envRoot = resolve(desktopRoot, '.artifacts/ocr-env')
  const pythonPath = resolve(envRoot, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  if (!existsSync(pythonPath)) {
    let bootstrapped = false
    for (const host of ['python.exe', 'py']) {
      try {
        await execFileText(host, process.platform === 'win32' && host === 'py' ? ['-3', '-m', 'venv', '--clear', envRoot] : ['-m', 'venv', '--clear', envRoot], 120_000)
        bootstrapped = true
        break
      } catch {}
    }
    if (!bootstrapped) throw new Error('本机没有可用的 Python 来搭建识别环境，请重新安装应用（安装包内置识别组件）。')
  }
  await execFileText(pythonPath, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ...PROVISION_PACKAGES], 900_000)
  const provisioned = await inspectOcrCapabilities({ ...settings, pythonPath }, desktopRoot, resourcesPath)
  if (!provisioned.ready) throw new Error(`识别环境搭建完成，但组件自检未通过：${provisioned.reason ?? '原因未知'}`)
  return { pythonPath: provisioned.pythonPath ?? pythonPath }
}

async function inspectPython(command: string): Promise<{ providers: string[] }> {
  const script = [
    'import json',
    'import fitz',
    'import onnxruntime as ort',
    'from rapidocr_onnxruntime import RapidOCR',
    'print(json.dumps({"providers": ort.get_available_providers()}))',
  ].join(';')
  const { stdout } = await execFileText(command, ['-c', script], 20_000)
  const parsed = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as { providers?: unknown }
  return { providers: Array.isArray(parsed.providers) ? parsed.providers.filter((item): item is string => typeof item === 'string') : [] }
}

async function hardwareGpuName(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileText('nvidia-smi.exe', ['--query-gpu=name', '--format=csv,noheader'], 5_000)
    return stdout.trim().split(/\r?\n/u)[0] || undefined
  } catch {
    return undefined
  }
}

const GPU_PROVIDERS = ['CUDAExecutionProvider', 'ROCMExecutionProvider', 'DmlExecutionProvider', 'CoreMLExecutionProvider'] as const

export async function inspectOcrCapabilities(settings: OcrSettings, desktopRoot: string, resourcesPath: string): Promise<OcrCapabilities> {
  const hardwareGpu = await hardwareGpuName()
  let lastReason = '未找到可用的本地 OCR 运行时。'
  for (const command of pythonCandidates(settings.pythonPath, desktopRoot, resourcesPath)) {
    if (command.includes('\\') && !existsSync(command)) continue
    try {
      const result = await inspectPython(command)
      const gpuProvider = GPU_PROVIDERS.find((provider) => result.providers.includes(provider))
      return {
        ready: true,
        pythonPath: command,
        providers: result.providers,
        ...(gpuProvider === undefined ? {} : { gpuProvider }),
        ...(hardwareGpu === undefined ? {} : { hardwareGpu }),
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
  }
  return { ready: false, providers: [], ...(hardwareGpu === undefined ? {} : { hardwareGpu }), reason: lastReason }
}

/** Install the DirectX-accelerated ONNX runtime into the detected local OCR environment. */
export async function installOcrGpuAcceleration(settings: OcrSettings, desktopRoot: string, resourcesPath: string): Promise<{ gpuProvider: string }> {
  const current = await inspectOcrCapabilities(settings, desktopRoot, resourcesPath)
  if (!current.ready || current.pythonPath === undefined) throw new Error('本地识别组件未就绪，无法安装显卡加速。请先确认本地识别组件可用。')
  if (current.gpuProvider !== undefined) return { gpuProvider: current.gpuProvider }
  await execFileText(
    current.pythonPath,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', 'onnxruntime-directml'],
    900_000,
  )
  const after = await inspectOcrCapabilities(settings, desktopRoot, resourcesPath)
  if (after.gpuProvider === undefined) {
    throw new Error('显卡加速组件已安装，但仍未检测到可用的加速后端。请重启应用后重新检测。')
  }
  return { gpuProvider: after.gpuProvider }
}

export async function benchmarkOcr(
  settings: OcrSettings,
  filePath: string,
  desktopRoot: string,
  resourcesPath: string,
): Promise<OcrBenchmarkResult> {
  const capabilities = await inspectOcrCapabilities(settings, desktopRoot, resourcesPath)
  if (!capabilities.ready || capabilities.pythonPath === undefined) {
    return unavailableBenchmark(settings, capabilities.reason ?? '本地 OCR 运行时不可用。')
  }
  if (settings.gpuEnabled && capabilities.gpuProvider === undefined) {
    return unavailableBenchmark(settings, capabilities.hardwareGpu === undefined
      ? '已启用 GPU OCR，但未检测到受支持的 GPU Provider。'
      : `检测到 ${capabilities.hardwareGpu}，但 OCR 运行时没有 CUDA/DirectML Provider。`)
  }
  const scriptPath = resolve(resourcesPath, 'lawclaw/scripts/privacy/pdf_extract.py')
  if (!existsSync(scriptPath)) return unavailableBenchmark(settings, '安装包缺少 OCR 脚本。')
  const args = [
    scriptPath,
    '--benchmark-file', filePath,
    '--benchmark-pages', '6',
    '--threads', String(settings.threads),
    '--dpi', String(settings.dpi),
    '--memory-limit-mb', String(settings.memoryLimitMb),
    settings.gpuEnabled ? '--gpu' : '--cpu',
  ]
  try {
    const { stdout } = await execFileText(capabilities.pythonPath, args, 5 * 60_000)
    const raw = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as Record<string, unknown>
    const secondsPerPage = Number(raw.secondsPerPage) || 0
    const peakMemoryMb = Number(raw.peakMemoryMb) || 0
    const gpu = typeof raw.gpu === 'object' && raw.gpu !== null ? raw.gpu as Record<string, unknown> : {}
    const provider = typeof gpu.provider === 'string' ? gpu.provider : 'CPUExecutionProvider'
    const projected100 = secondsPerPage * 100 / 60
    const projected1000 = secondsPerPage * 1_000 / 60
    const slow = secondsPerPage > 2 || peakMemoryMb > settings.memoryLimitMb * 0.85
    return {
      status: slow ? 'slow' : 'good',
      pages: Number(raw.pages) || 0,
      sourcePages: Number(raw.sourcePages) || 0,
      seconds: Number(raw.seconds) || 0,
      secondsPerPage,
      peakMemoryMb,
      projectedMinutes100Pages: Math.round(projected100 * 10) / 10,
      projectedMinutes1000Pages: Math.round(projected1000 * 10) / 10,
      provider,
      gpuEnabled: provider !== 'CPUExecutionProvider',
      message: slow
        ? '本机可以完成识别，但大卷宗耗时或内存压力较高。'
        : '本机 OCR 性能适合继续本地处理。',
    }
  } catch (error) {
    return unavailableBenchmark(settings, error instanceof Error ? error.message : String(error))
  }
}

function unavailableBenchmark(settings: OcrSettings, message: string): OcrBenchmarkResult {
  return {
    status: 'unavailable',
    pages: 0,
    sourcePages: 0,
    seconds: 0,
    secondsPerPage: 0,
    peakMemoryMb: 0,
    projectedMinutes100Pages: 0,
    projectedMinutes1000Pages: 0,
    provider: settings.gpuEnabled ? 'GPU requested' : 'Unavailable',
    gpuEnabled: false,
    message,
  }
}

export async function invokeCloudOcr(settings: OcrSettings, filePath: string): Promise<unknown> {
  if (settings.mode !== 'cloud') throw new Error('云端 OCR 尚未启用。')
  if (settings.cloudEndpoint === '' || settings.cloudApiKey === '') throw new Error('请先填写云端 OCR 地址和 API Key。')
  const bytes = readFileSync(filePath)
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('单个云端 OCR 文件不能超过 100 MB。')
  const form = new FormData()
  form.set('file', new Blob([bytes]), basename(filePath))
  if (settings.cloudModel !== '') form.set('model', settings.cloudModel)
  const response = await fetch(settings.cloudEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.cloudApiKey}` },
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(httpFailureMessage('云端 OCR 服务出错', response.status, response.statusText, text))
  try { return JSON.parse(text) as unknown } catch { return { text } }
}
