import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { OcrBenchmarkResult, OcrCapabilities, OcrSettings } from '../types'
import { friendlyErrorText } from '../friendly-error'
import { Icon } from './Icon'

const BENCHMARK_KEY = 'lawclaw.ocr.benchmark.v1'

const fallbackSettings: OcrSettings = {
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

function readBenchmark(): OcrBenchmarkResult | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(BENCHMARK_KEY) ?? 'null') as unknown
    return typeof value === 'object' && value !== null ? value as OcrBenchmarkResult : undefined
  } catch {
    return undefined
  }
}

export function OcrSettingsPane(): React.ReactElement {
  const [settings, setSettings] = useState<OcrSettings>(fallbackSettings)
  const [capabilities, setCapabilities] = useState<OcrCapabilities | undefined>()
  const [benchmark, setBenchmark] = useState<OcrBenchmarkResult | undefined>(readBenchmark)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [benchmarking, setBenchmarking] = useState(false)
  const [cloudRiskOpen, setCloudRiskOpen] = useState(false)
  const [cloudAcknowledged, setCloudAcknowledged] = useState(false)
  const [pendingCloudFile, setPendingCloudFile] = useState<string | undefined>()
  const [testingCloud, setTestingCloud] = useState(false)
  const pushToast = useApp((state) => state.pushToast)
  const developerMode = useApp((state) => state.developerMode)

  function toastError(reason: unknown): void {
    pushToast('error', friendlyErrorText(reason))
  }

  function displayOcrDetail(text: string | undefined): string {
    if (text === undefined || text.trim() === '') return ''
    if (developerMode) return text
    return /Error|Traceback|No module|Exception|File "/iu.test(text)
      ? '本地识别组件存在问题，请点击“重新检测”；若反复出现，请重新安装应用，或改用云端识别。'
      : text
  }

  async function refreshCapabilities(): Promise<OcrCapabilities> {
    const value = await window.desktop.ocr.capabilities()
    setCapabilities(value)
    return value
  }

  useEffect(() => {
    void Promise.all([window.desktop.ocr.read(), window.desktop.ocr.capabilities()])
      .then(([nextSettings, nextCapabilities]) => {
        setSettings(nextSettings)
        setCapabilities(nextCapabilities)
      })
      .catch(toastError)
      .finally(() => setLoading(false))
  }, [])

  async function toggleGpu(): Promise<void> {
    if (settings.gpuEnabled) {
      setSettings({ ...settings, gpuEnabled: false })
      return
    }

    if (capabilities !== undefined) {
      if (capabilities.gpuProvider !== undefined) {
        setSettings({ ...settings, gpuEnabled: true })
        return
      }
      pushToast('info', capabilities.hardwareGpu === undefined
        ? '没有检测到可用的独立显卡，本地识别将使用 CPU 处理，速度较慢。'
        : `检测到显卡 ${capabilities.hardwareGpu}，但显卡加速组件尚未安装，当前使用 CPU 识别，速度较慢。可在“程序自检”中一键安装。`)
      return
    }

    setSettings({ ...settings, gpuEnabled: true })
    try {
      const value = await refreshCapabilities()
      if (value.gpuProvider === undefined) {
        setSettings((current) => ({ ...current, gpuEnabled: false }))
        pushToast('info', value.hardwareGpu === undefined
          ? '没有检测到可用的独立显卡，本地识别将使用 CPU 处理，速度较慢。'
          : `检测到显卡 ${value.hardwareGpu}，但显卡加速组件尚未安装，当前使用 CPU 识别，速度较慢。可在“程序自检”中一键安装。`)
        return
      }
    } catch (reason) {
      setSettings((current) => ({ ...current, gpuEnabled: false }))
      toastError(reason)
    }
  }

  async function save(): Promise<OcrSettings | undefined> {
    setSaving(true)
    try {
      const normalized = await window.desktop.ocr.save(settings)
      setSettings(normalized)
      pushToast('success', 'OCR 设置已保存')
      return normalized
    } catch (reason) {
      toastError(reason)
      return undefined
    } finally {
      setSaving(false)
    }
  }

  async function runBenchmark(): Promise<void> {
    setBenchmarking(true)
    try {
      const savedSettings = await save()
      if (savedSettings === undefined) return
      const filePath = await window.desktop.ocr.chooseBenchmarkFile()
      if (filePath === undefined) return
      const result = await window.desktop.ocr.benchmark(filePath)
      setBenchmark(result)
      localStorage.setItem(BENCHMARK_KEY, JSON.stringify(result))
      if (result.status !== 'good') {
        setCloudAcknowledged(false)
        setCloudRiskOpen(true)
      }
    } catch (reason) {
      toastError(reason)
    } finally {
      setBenchmarking(false)
    }
  }

  async function chooseCloudTestFile(): Promise<void> {
    const savedSettings = await save()
    if (savedSettings === undefined) return
    if (savedSettings.cloudEndpoint === '' || savedSettings.cloudApiKey === '') {
      pushToast('error', '请先填写云端 OCR 服务地址和 API Key。')
      return
    }
    const filePath = await window.desktop.ocr.chooseCloudFile()
    if (filePath === undefined) return
    setPendingCloudFile(filePath)
    setCloudAcknowledged(false)
    setCloudRiskOpen(true)
  }

  async function confirmCloudAction(): Promise<void> {
    if (!cloudAcknowledged) return
    if (pendingCloudFile === undefined) {
      setSettings({ ...settings, mode: 'cloud' })
      setCloudRiskOpen(false)
      return
    }
    setTestingCloud(true)
    try {
      await window.desktop.ocr.testCloud(pendingCloudFile, true)
      pushToast('success', '云端服务测试成功')
      setCloudRiskOpen(false)
      setPendingCloudFile(undefined)
    } catch (reason) {
      toastError(reason)
      setCloudRiskOpen(false)
    } finally {
      setTestingCloud(false)
    }
  }

  const localReady = capabilities?.ready === true
  const gpuReady = capabilities?.gpuProvider !== undefined

  return (
    <>
      <section className="settings-pane">
        <div className="settings-section-copy"><span className="eyebrow">DOCUMENT OCR</span><h2>材料识别</h2><p>默认只在本机处理案件材料。先测速，再决定是否需要云端服务。</p></div>

        <div className="ocr-mode-switch" role="group" aria-label="OCR 处理位置">
          <button aria-pressed={settings.mode === 'local'} className={settings.mode === 'local' ? 'is-selected' : ''} onClick={() => { setSettings({ ...settings, mode: 'local' }) }} type="button"><Icon name="monitor" size={17} /><span><strong>本地 OCR</strong><small>材料不离开设备</small></span></button>
          <button aria-pressed={settings.mode === 'cloud'} className={settings.mode === 'cloud' ? 'is-selected' : ''} onClick={() => { setPendingCloudFile(undefined); setCloudAcknowledged(false); setCloudRiskOpen(true) }} type="button"><Icon name="globe" size={17} /><span><strong>云端 OCR</strong><small>每次上传都需明确授权</small></span></button>
        </div>

        {settings.mode === 'local' && (
        <div className="settings-card ocr-card">
          <div className="ocr-status-row">
            <div><span className={`ocr-status-dot ${localReady ? 'is-ready' : 'is-warning'}`} /><span><strong>{localReady ? '本地识别组件就绪' : '本地识别组件未就绪'}</strong><small>{localReady ? (developerMode ? capabilities?.pythonPath ?? '' : '扫描件只在本机处理，不会上传。') : displayOcrDetail(capabilities?.reason)}</small></span></div>
            <button className="button" disabled={loading} onClick={() => void refreshCapabilities()} type="button"><Icon name="refresh" size={14} />重新检测</button>
          </div>

          <div className="ocr-preference-row">
            <div><strong>启用显卡加速</strong><small>{gpuReady ? '识别速度更快，推荐开启' : capabilities?.hardwareGpu === undefined ? '未检测到可用的独立显卡' : `检测到 ${capabilities?.hardwareGpu}，加速组件未安装`}</small></div>
            <button aria-checked={settings.gpuEnabled} aria-label="启用显卡加速" className={settings.gpuEnabled ? 'settings-toggle is-checked' : 'settings-toggle'} onClick={() => void toggleGpu()} role="switch" type="button"><span /></button>
          </div>
          <div className="ocr-grid-fields">
            <label><span>识别线程</span><input max={16} min={1} onChange={(event) => { setSettings({ ...settings, threads: Number(event.target.value) }) }} type="number" value={settings.threads} /></label>
            <label><span>渲染 DPI</span><input max={300} min={96} onChange={(event) => { setSettings({ ...settings, dpi: Number(event.target.value) }) }} type="number" value={settings.dpi} /></label>
            <label><span>内存上限（MB）</span><input max={16384} min={512} onChange={(event) => { setSettings({ ...settings, memoryLimitMb: Number(event.target.value) }) }} type="number" value={settings.memoryLimitMb} /></label>
          </div>
          <label className="field"><span>本地 Python <small>留空自动检测；正式安装包优先使用内置运行时</small></span><input onChange={(event) => { setSettings({ ...settings, pythonPath: event.target.value }) }} placeholder="自动检测" spellCheck={false} value={settings.pythonPath} /></label>

          {developerMode && benchmark !== undefined && (
            <div className={`ocr-benchmark-result is-${benchmark.status}`}>
              <div><Icon name={benchmark.status === 'good' ? 'check' : 'activity'} size={18} /><span><strong>{displayOcrDetail(benchmark.message)}</strong><small>{benchmark.provider} · {benchmark.pages === 0 ? '未执行识别' : `${String(benchmark.pages)} 页用时 ${benchmark.seconds.toFixed(1)} 秒`}</small></span></div>
              {benchmark.pages > 0 && <dl><div><dt>每页</dt><dd>{benchmark.secondsPerPage.toFixed(2)} 秒</dd></div><div><dt>100 页预计</dt><dd>{benchmark.projectedMinutes100Pages.toFixed(1)} 分钟</dd></div><div><dt>1000 页预计</dt><dd>{benchmark.projectedMinutes1000Pages.toFixed(1)} 分钟</dd></div><div><dt>峰值内存</dt><dd>{benchmark.peakMemoryMb.toFixed(0)} MB</dd></div></dl>}
            </div>
          )}

          <div className="settings-card-actions">
            {developerMode && <button className="button" disabled={benchmarking || loading} onClick={() => void runBenchmark()} type="button">{benchmarking ? '正在识别 6 页样本…' : '选择扫描件并测速'}</button>}
            <button className="button button-primary" disabled={saving || loading} onClick={() => void save()} type="button">{saving ? '保存中…' : '保存设置'}</button>
          </div>
        </div>
        )}

        {settings.mode === 'cloud' && (
          <div className="settings-card ocr-cloud-card">
            <div className="ocr-cloud-heading"><Icon name="shield" size={18} /><div><strong>云端 OCR 配置</strong><small>只有你确认单次上传后，LawClaw 才会发送材料。</small></div></div>
            <label className="field"><span>服务地址</span><input onChange={(event) => { setSettings({ ...settings, cloudEndpoint: event.target.value }) }} placeholder="https://…/ocr" type="url" value={settings.cloudEndpoint} /></label>
            <div className="ocr-grid-fields">
              <label><span>模型/服务名</span><input onChange={(event) => { setSettings({ ...settings, cloudModel: event.target.value }) }} placeholder="由服务商提供" value={settings.cloudModel} /></label>
              <label><span>API Key</span><input onChange={(event) => { setSettings({ ...settings, cloudApiKey: event.target.value }) }} placeholder="仅保存在本机配置" type="password" value={settings.cloudApiKey} /></label>
            </div>
            <div className="settings-card-actions">
              <button className="button" disabled={saving || testingCloud} onClick={() => void chooseCloudTestFile()} type="button">{testingCloud ? '正在上传并测试…' : '选择一份材料测试服务'}</button>
              <button className="button button-primary" disabled={saving} onClick={() => void save()} type="button">保存云端配置</button>
            </div>
            <div className="ocr-grid-fields">
              <label><span>模型使用条款</span><input onChange={(event) => { setSettings({ ...settings, termsUrl: event.target.value }) }} type="url" value={settings.termsUrl} /></label>
              <label><span>隐私政策</span><input onChange={(event) => { setSettings({ ...settings, privacyUrl: event.target.value }) }} type="url" value={settings.privacyUrl} /></label>
            </div>
          </div>
        )}
      </section>

      {cloudRiskOpen && (
        <div className="permission-confirm-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target) setCloudRiskOpen(false) }}>
          <div aria-labelledby="cloud-ocr-risk-title" aria-modal="true" className="permission-confirm-dialog ocr-risk-dialog" role="dialog">
            <div className="permission-confirm-icon"><Icon name="shield" size={20} /></div>
            <h2 id="cloud-ocr-risk-title">{pendingCloudFile === undefined ? '启用云端 OCR 前请确认风险' : '这份案件材料将发送给第三方服务'}</h2>
            <p>云端 OCR 可能接触姓名、证件号码、联系方式、案情和证据内容，存在信息泄露、跨境传输或服务商留存风险。请先确认你有权上传，并核对当前模型与服务商条款。</p>
            <div className="ocr-policy-links">{settings.termsUrl === '' ? <span>未填写模型使用条款</span> : <a href={settings.termsUrl} rel="noreferrer" target="_blank">查看模型使用条款<Icon name="external" size={13} /></a>}{settings.privacyUrl === '' ? <span>未填写隐私政策</span> : <a href={settings.privacyUrl} rel="noreferrer" target="_blank">查看隐私政策<Icon name="external" size={13} /></a>}</div>
            <label className="permission-confirm-check"><input checked={cloudAcknowledged} onChange={(event) => setCloudAcknowledged(event.target.checked)} type="checkbox" /><span>我确认已获得处理和上传案件材料的合法授权，并理解上述风险。</span></label>
            <div className="permission-confirm-actions"><button onClick={() => { setCloudRiskOpen(false); setPendingCloudFile(undefined) }} type="button">取消，不上传</button><button className="is-primary" disabled={!cloudAcknowledged || testingCloud} onClick={() => void confirmCloudAction()} type="button">{pendingCloudFile === undefined ? '进入云端配置' : testingCloud ? '正在上传…' : '仅上传这一次'}</button></div>
          </div>
        </div>
      )}
    </>
  )
}
