import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store'
import type { SettingsTab } from './SettingsView'
import { friendlyErrorText } from '../friendly-error'
import { Icon } from './Icon'

type CheckStatus = 'ok' | 'warn' | 'fail'

interface SelfCheckAction {
  kind: 'repair' | 'navigate' | 'retry'
  label: string
  tab?: Extract<SettingsTab, 'models' | 'agents'>
}

interface SelfCheckItem {
  id: 'host' | 'models' | 'agents' | 'ocr' | 'mcp'
  status: CheckStatus
  title: string
  detail: string
  action?: SelfCheckAction
}

function gpuLabel(provider: string): string {
  if (provider.includes('CUDA')) return 'CUDA'
  if (provider.includes('Dml')) return 'DirectML'
  if (provider.includes('ROCM')) return 'ROCm'
  if (provider.includes('CoreML')) return 'CoreML'
  return provider
}

export function SelfCheckPane({ onNavigate }: { onNavigate: (tab: SelfCheckAction['tab']) => void }): React.ReactElement {
  const dshUrl = useApp((state) => state.dshUrl)
  const connectionError = useApp((state) => state.connectionError)
  const pushToast = useApp((state) => state.pushToast)
  const [items, setItems] = useState<SelfCheckItem[]>([])
  const [checking, setChecking] = useState(true)
  const [repairing, setRepairing] = useState<string | undefined>()

  const runChecks = useCallback(async (): Promise<void> => {
    setChecking(true)
    const results: SelfCheckItem[] = []

    results.push(dshUrl === undefined || connectionError !== undefined
      ? { id: 'host', status: 'fail', title: '能力服务未连接', detail: connectionError ?? '本地能力服务没有响应，Agent 与工具均不可用。', action: { kind: 'repair', label: '重启能力服务' } }
      : { id: 'host', status: 'ok', title: '能力服务已连接', detail: 'Agent 运行时、工具与技能都由它提供。' })

    try {
      const providers = await window.desktop.models.providers.read()
      const usable = providers.filter((provider) => provider.enabled && provider.baseUrl.trim() !== '' && provider.apiKey.trim() !== '')
      const modelCount = usable.reduce((total, provider) => total + provider.models.filter((model) => model.enabled).length, 0)
      if (usable.length === 0) {
        results.push({ id: 'models', status: 'fail', title: '尚未配置可用的模型服务商', detail: 'Agent 需要至少一个启用了 API Key 的服务商才能运行。', action: { kind: 'navigate', label: '去配置模型', tab: 'models' } })
      } else if (modelCount === 0) {
        results.push({ id: 'models', status: 'warn', title: '服务商已配置，但还没有启用任何模型', detail: '对话和各案件角色都需要至少一个启用中的模型。', action: { kind: 'navigate', label: '去启用模型', tab: 'models' } })
      } else {
        results.push({ id: 'models', status: 'ok', title: `模型服务就绪（${String(modelCount)} 个模型可用）`, detail: usable.map((provider) => provider.name).join('、') })
      }
    } catch (reason) {
      results.push({ id: 'models', status: 'fail', title: '无法读取模型配置', detail: friendlyErrorText(reason), action: { kind: 'retry', label: '重新检测' } })
    }

    try {
      const agents = await window.desktop.agents.list()
      const enabledAgents = agents.filter((agent) => agent.enabled)
      const unbound = enabledAgents.filter((agent) => agent.provider === '' || agent.model === '')
      if (enabledAgents.length === 0) {
        results.push({ id: 'agents', status: 'warn', title: '所有案件角色都已停用', detail: '启用至少一个角色后，Agent 团队才会参与案件分析。', action: { kind: 'navigate', label: '去配置角色', tab: 'agents' } })
      } else if (unbound.length > 0) {
        results.push({ id: 'agents', status: 'warn', title: `${String(unbound.length)} 个角色未绑定专属模型`, detail: `${unbound.map((agent) => agent.name).join('、')} 将使用全局默认模型。`, action: { kind: 'navigate', label: '去配置角色', tab: 'agents' } })
      } else {
        results.push({ id: 'agents', status: 'ok', title: `Agent 团队就绪（${String(enabledAgents.length)} 个角色）`, detail: '每个启用的角色都绑定了模型。' })
      }
    } catch (reason) {
      results.push({ id: 'agents', status: 'fail', title: '无法读取 Agent 配置', detail: friendlyErrorText(reason), action: { kind: 'retry', label: '重新检测' } })
    }

    try {
      const capabilities = await window.desktop.ocr.capabilities()
      if (!capabilities.ready) {
        results.push({
          id: 'ocr',
          status: 'fail',
          title: '本地识别组件未安装',
          detail: '可以自动搭建本地识别环境（需要联网，约 1-2 分钟）；或改用云端识别。',
          action: { kind: 'repair', label: '自动搭建识别环境' },
        })
      } else if (capabilities.gpuProvider === undefined) {
        const hasGpu = capabilities.hardwareGpu !== undefined
        results.push({
          id: 'ocr',
          status: 'warn',
          title: hasGpu ? '本地识别可用，但显卡加速组件未安装' : '本地识别可用，未检测到独立显卡',
          detail: hasGpu
            ? `检测到显卡 ${capabilities.hardwareGpu}，当前使用 CPU 识别，速度较慢。`
            : '扫描件将使用 CPU 识别，速度较慢；不影响云端识别。',
          ...(hasGpu ? { action: { kind: 'repair', label: '安装显卡加速' } as SelfCheckAction } : {}),
        })
      } else {
        results.push({ id: 'ocr', status: 'ok', title: `本地识别就绪（${gpuLabel(capabilities.gpuProvider)} 加速）`, detail: `识别环境：${capabilities.pythonPath ?? '默认'}。` })
      }
    } catch (reason) {
      results.push({ id: 'ocr', status: 'fail', title: '无法检测本地识别组件', detail: friendlyErrorText(reason), action: { kind: 'retry', label: '重新检测' } })
    }

    try {
      const servers = await window.desktop.mcp.read()
      const enabledCount = servers.filter((server) => server.enabled).length
      results.push(enabledCount === 0
        ? { id: 'mcp', status: 'ok', title: '未启用 MCP 服务（可选）', detail: '不需要接入外部工具时可以忽略这一项。' }
        : { id: 'mcp', status: 'ok', title: `MCP 服务已配置（启用 ${String(enabledCount)} 个）`, detail: '外部工具将通过这些服务接入 Agent。' })
    } catch {
      results.push({ id: 'mcp', status: 'warn', title: '无法读取 MCP 配置', detail: '外部工具接入状态未知，可在“MCP 服务”页检查。' })
    }

    setItems(results)
    setChecking(false)
  }, [connectionError, dshUrl])

  useEffect(() => { void runChecks() }, [runChecks])

  async function performRepair(item: SelfCheckItem): Promise<void> {
    if (item.id === 'host') {
      await window.desktop.runtime.restart()
      pushToast('success', '能力服务已重启。')
      return
    }
    if (item.id === 'ocr') {
      const capabilities = await window.desktop.ocr.capabilities()
      if (capabilities.ready && capabilities.gpuProvider === undefined) {
        const result = await window.desktop.ocr.installGpuAcceleration()
        pushToast('success', `显卡加速已安装（${gpuLabel(result.gpuProvider)}），本地识别速度会明显提升。`)
        return
      }
      const result = await window.desktop.ocr.provision()
      pushToast('success', `本地识别环境已就绪（${result.pythonPath}）。`)
    }
  }

  async function runAction(item: SelfCheckItem): Promise<void> {
    const action = item.action
    if (action === undefined) return
    if (action.kind === 'navigate' && action.tab !== undefined) {
      onNavigate(action.tab)
      return
    }
    if (action.kind === 'retry') {
      await runChecks()
      return
    }
    setRepairing(item.id)
    try {
      await performRepair(item)
    } catch (reason) {
      pushToast('error', friendlyErrorText(reason))
    } finally {
      setRepairing(undefined)
      await runChecks()
    }
  }

  async function repairAll(): Promise<void> {
    const repairables = items.filter((item) => item.action?.kind === 'repair')
    for (const item of repairables) {
      setRepairing(item.id)
      try {
        await performRepair(item)
      } catch (reason) {
        pushToast('error', friendlyErrorText(reason))
      }
    }
    setRepairing(undefined)
    await runChecks()
  }

  const repairCount = items.filter((item) => item.action?.kind === 'repair').length

  return (
    <section className="settings-pane selfcheck-pane">
      <div className="management-heading">
        <div><span className="eyebrow">SELF CHECK</span><h2>程序自检</h2><p>检测本机运行所需的全部资源。黄色项可以稍后处理，红色项需要立即修复。</p></div>
        <div className="selfcheck-heading-actions">
          <button className="button" disabled={checking || repairing !== undefined} onClick={() => void runChecks()} type="button"><Icon name="refresh" size={15} />重新检测</button>
          <button className="button button-primary" disabled={checking || repairCount === 0 || repairing !== undefined} onClick={() => void repairAll()} type="button">{repairing !== undefined ? '正在修复…' : repairCount > 0 ? `一键修复（${String(repairCount)}）` : '一键修复'}</button>
        </div>
      </div>

      <div className="selfcheck-list">
        {checking && items.length === 0 && (
          <div className="selfcheck-row is-checking"><span className="mini-spinner" /><div><strong>正在检测本机资源…</strong><small>通常几秒内完成。</small></div></div>
        )}
        {items.map((item) => (
          <div className={`selfcheck-row is-${item.status}`} key={item.id}>
            <span aria-hidden="true" className="selfcheck-dot" />
            <div><strong>{item.title}</strong><small>{item.detail}</small></div>
            {item.action !== undefined && (
              <button className={item.action.kind === 'repair' ? 'button button-primary' : 'button'} disabled={checking || repairing !== undefined} onClick={() => void runAction(item)} type="button">{repairing === item.id && <span className="mini-spinner" />}{item.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
