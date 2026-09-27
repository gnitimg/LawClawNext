import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import type { DesktopModelEntry, DesktopModelProvider, RuntimeConfigStatus } from '../types'
import { friendlyErrorText } from '../friendly-error'
import { Icon } from './Icon'

function emptyProvider(): DesktopModelProvider {
  const id = crypto.randomUUID()
  return {
    id,
    route: `lawclaw-${id.slice(0, 8)}`,
    name: '',
    enabled: true,
    apiFormat: 'openai-completions',
    baseUrl: '',
    apiKey: '',
    models: [],
  }
}

function toModel(id: string, name = id, enabled = false, vision = false): DesktopModelEntry {
  return { id, name, enabled, contextWindow: 128_000, maxTokens: 8_192, vision }
}

export function ModelProvidersPane(): React.ReactElement {
  const [providers, setProviders] = useState<DesktopModelProvider[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [draft, setDraft] = useState<DesktopModelProvider | undefined>()
  const [manualModel, setManualModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingModel, setTestingModel] = useState<string | undefined>()
  const [modelQuery, setModelQuery] = useState('')
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeConfigStatus | undefined>()
  const pushToast = useApp((state) => state.pushToast)

  function toastError(reason: unknown): void {
    pushToast('error', friendlyErrorText(reason))
  }

  useEffect(() => {
    void window.desktop.models.providers.read()
      .then((items) => {
        setProviders(items)
        setSelectedId(items[0]?.id)
      })
      .catch(toastError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void window.desktop.runtime.configStatus().then(setRuntimeStatus)
    return window.desktop.runtime.onConfigStatus((status) => {
      setRuntimeStatus(status)
      if (!status.scopes.includes('models')) return
      if (status.status === 'applied') pushToast('success', status.message)
      if (status.status === 'error') pushToast('error', friendlyErrorText(status.message))
    })
  }, [])

  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId) ?? providers[0], [providers, selectedId])
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    if (query === '') return selected?.models ?? []
    return (selected?.models ?? []).filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
  }, [modelQuery, selected])

  async function persist(next: DesktopModelProvider[]): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.desktop.models.providers.save(next)
      setProviders(saved)
      if (selectedId === undefined && saved[0] !== undefined) setSelectedId(saved[0].id)
    } catch (reason) {
      toastError(reason)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  async function testDraft(): Promise<void> {
    if (draft === undefined) return
    setTesting(true)
    try {
      const result = await window.desktop.models.providers.test(draft)
      const existing = new Map(draft.models.map((model) => [model.id, model]))
      const discovered = result.models.map((model) => {
        const current = existing.get(model.id)
        return current === undefined ? toModel(model.id, model.name, false, model.vision === true) : { ...current, name: model.name, vision: current.vision || model.vision === true }
      })
      setDraft({ ...draft, models: [...draft.models.filter((model) => !result.models.some((item) => item.id === model.id)), ...discovered] })
      pushToast('success', result.message)
    } catch (reason) {
      toastError(reason)
    } finally {
      setTesting(false)
    }
  }

  async function saveDraft(): Promise<void> {
    if (draft === undefined) return
    const next = [...providers.filter((provider) => provider.id !== draft.id), draft]
    try {
      await persist(next)
      setSelectedId(draft.id)
      setDraft(undefined)
      setTesting(true)
      try {
        const result = await window.desktop.models.providers.test(draft)
        const existing = new Map(draft.models.map((model) => [model.id, model]))
        const discovered = result.models.map((model) => {
          const current = existing.get(model.id)
          return current === undefined ? toModel(model.id, model.name, false, model.vision === true) : { ...current, name: model.name, vision: current.vision || model.vision === true }
        })
        const models = [...draft.models.filter((model) => !result.models.some((item) => item.id === model.id)), ...discovered]
        await persist(next.map((provider) => provider.id === draft.id ? { ...provider, models } : provider))
      } catch (reason) {
        pushToast('error', `提供商已保存，但自动获取模型失败：${friendlyErrorText(reason)}`)
      } finally {
        setTesting(false)
      }
    } catch {
      // Failure already surfaced as a toast by persist().
    }
  }

  async function patchProvider(providerId: string, patch: Partial<DesktopModelProvider>): Promise<void> {
    const next = providers.map((provider) => provider.id === providerId ? { ...provider, ...patch } : provider)
    await persist(next).catch(() => {})
  }

  async function patchModel(provider: DesktopModelProvider, modelId: string, patch: Partial<DesktopModelEntry>): Promise<void> {
    await patchProvider(provider.id, { models: provider.models.map((model) => model.id === modelId ? { ...model, ...patch } : model) })
  }

  async function addManualModel(): Promise<void> {
    if (selected === undefined) return
    const id = manualModel.trim()
    if (id === '' || selected.models.some((model) => model.id === id)) return
    setManualModel('')
    await patchProvider(selected.id, { models: [...selected.models, toModel(id, id, selected.models.length === 0)] })
  }

  async function refreshSelectedModels(): Promise<void> {
    if (selected === undefined) return
    setTesting(true)
    try {
      const result = await window.desktop.models.providers.test(selected)
      const existing = new Map(selected.models.map((model) => [model.id, model]))
      const discovered = result.models.map((model) => {
        const current = existing.get(model.id)
        return current === undefined ? toModel(model.id, model.name, false, model.vision === true) : { ...current, name: model.name, vision: current.vision || model.vision === true }
      })
      const models = [...selected.models.filter((model) => !result.models.some((item) => item.id === model.id)), ...discovered]
      await patchProvider(selected.id, { models })
      pushToast('success', result.message)
    } catch (reason) {
      toastError(reason)
    } finally {
      setTesting(false)
    }
  }

  async function testModel(model: DesktopModelEntry): Promise<void> {
    if (selected === undefined) return
    setTestingModel(model.id)
    try {
      const result = await window.desktop.models.providers.testModel(selected, model.id)
      pushToast('success', result.message)
    } catch (reason) {
      toastError(reason)
    } finally {
      setTestingModel(undefined)
    }
  }

  async function removeSelected(): Promise<void> {
    if (selected === undefined) return
    const next = providers.filter((provider) => provider.id !== selected.id)
    setSelectedId(next[0]?.id)
    await persist(next).catch(() => {})
  }

  return (
    <section className="settings-pane model-provider-admin">
      <div className="model-admin-heading">
        <div><span className="eyebrow">MODEL PROVIDERS</span><h2>模型设置</h2><p>管理不同厂商的兼容接口，并选择要交给 Agent 使用的模型。</p></div>
        <button className="button button-primary" disabled={loading || busy} onClick={() => { setDraft(emptyProvider()); setManualModel('') }} type="button"><Icon name="plus" size={15} />新建提供商</button>
      </div>

      {runtimeStatus !== undefined && runtimeStatus.status === 'applying' && runtimeStatus.scopes.includes('models') && <div className="provider-runtime-status is-applying" role="status"><span className="mini-spinner" /><span>{runtimeStatus.message}</span></div>}

      {!loading && providers.length === 0 ? (
        <div className="provider-empty-state">
          <span><Icon name="cache" size={24} /></span>
          <strong>未配置提供商</strong>
          <p>添加 OpenAI 或 Anthropic 兼容服务后，才能在案件对话中选择模型。</p>
          <button className="button button-primary" onClick={() => setDraft(emptyProvider())} type="button"><Icon name="plus" size={15} />新建提供商</button>
        </div>
      ) : providers.length > 0 && (
        <div className="model-provider-workbench">
          <aside className="provider-index">
            <div className="provider-index-caption"><span>自定义提供商</span><b>{providers.length}</b></div>
            {providers.map((provider) => (
              <button className={provider.id === selected?.id ? 'is-selected' : ''} key={provider.id} onClick={() => setSelectedId(provider.id)} type="button">
                <span className="provider-glyph">{provider.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{provider.name}</strong><small>{provider.apiFormat === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Chat Completions'}</small></span>
                <i className={provider.enabled && provider.models.some((model) => model.enabled) ? 'is-ready' : ''} />
              </button>
            ))}
          </aside>

          {selected !== undefined && (
            <div className="provider-detail-panel">
              <header>
                <div><span className="provider-glyph large">{selected.name.slice(0, 1).toUpperCase()}</span><span><h3>{selected.name}</h3><small>{selected.route}</small></span></div>
                <div className="provider-detail-actions">
                  <button aria-label={selected.enabled ? '停用提供商' : '启用提供商'} className={`settings-toggle ${selected.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void patchProvider(selected.id, { enabled: !selected.enabled })} type="button"><span /></button>
                  <button className="icon-button subtle" onClick={() => { setDraft({ ...selected, models: selected.models.map((model) => ({ ...model })) }); setManualModel('') }} type="button"><Icon name="edit" size={15} /></button>
                  <button className="icon-button subtle danger-text" disabled={busy} onClick={() => void removeSelected()} type="button"><Icon name="trash" size={15} /></button>
                </div>
              </header>
              <dl className="provider-facts"><div><dt>Base URL</dt><dd>{selected.baseUrl}</dd></div><div><dt>API 格式</dt><dd>{selected.apiFormat === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Chat Completions'}</dd></div><div><dt>API Key</dt><dd>••••••••••••</dd></div></dl>
              <div className="provider-model-heading"><div><span>模型列表</span><b>{selected.models.filter((model) => model.enabled).length} / {selected.models.length} 已启用</b></div><div className="provider-model-tools"><label className="provider-model-search"><Icon name="search" size={14} /><input aria-label="搜索模型" onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" value={modelQuery} /></label><button disabled={testing || busy} onClick={() => void refreshSelectedModels()} type="button"><Icon name="refresh" size={14} />{testing ? '获取中…' : '获取模型'}</button><form onSubmit={(event) => { event.preventDefault(); void addManualModel() }}><input onChange={(event) => setManualModel(event.target.value)} placeholder="输入模型 ID" value={manualModel} /><button disabled={manualModel.trim() === '' || busy} type="submit"><Icon name="plus" size={14} />添加</button></form></div></div>
              <div className="provider-model-list">                {selected.models.length === 0 && <div className="provider-model-empty">正在等待模型目录；也可以手动添加模型 ID。</div>}
                {visibleModels.map((model) => (
                  <div key={model.id}><span><strong>{model.name}{model.vision && <em className="model-capability-tag">视觉</em>}</strong><small>{model.id}</small></span><div className="provider-model-actions"><button aria-label={`测试 ${model.name}`} className="icon-button subtle model-test-button" disabled={testingModel !== undefined} onClick={() => void testModel(model)} title="测试模型" type="button">{testingModel === model.id ? <span className="mini-spinner" /> : <Icon name="activity" size={14} />}</button><button aria-label={model.enabled ? `停用 ${model.name}` : `启用 ${model.name}`} className={`settings-toggle ${model.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void patchModel(selected, model.id, { enabled: !model.enabled })} type="button"><span /></button></div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {draft !== undefined && (
        <div className="provider-dialog-backdrop" onPointerDown={(event) => { if (event.currentTarget === event.target && !busy) setDraft(undefined) }}>
          <div aria-labelledby="provider-dialog-title" aria-modal="true" className="provider-dialog" role="dialog">
            <header><div><span className="eyebrow">CUSTOM PROVIDER</span><h3 id="provider-dialog-title">{providers.some((provider) => provider.id === draft.id) ? '编辑提供商' : '新建提供商'}</h3></div><button aria-label="关闭" className="icon-button subtle" disabled={busy} onClick={() => setDraft(undefined)} type="button"><Icon name="close" size={16} /></button></header>
            <div className="provider-dialog-grid">
              <label><span>提供商名称</span><input autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：阿里云百炼" value={draft.name} /></label>
              <label><span>输出格式</span><select onChange={(event) => setDraft({ ...draft, apiFormat: event.target.value === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions' })} value={draft.apiFormat}><option value="openai-completions">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
              <label className="span-2"><span>Base URL</span><input onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} type="url" value={draft.baseUrl} /></label>
              <label className="span-2"><span>API Key</span><input onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="输入 API Key" spellCheck={false} type="password" value={draft.apiKey} /></label>
            </div>
            <footer><button className="button" disabled={busy} onClick={() => setDraft(undefined)} type="button">取消</button><button className="button" disabled={testing || draft.baseUrl.trim() === '' || draft.apiKey.trim() === ''} onClick={() => void testDraft()} type="button">{testing ? '测试中…' : '测试连接'}</button><button className="button button-primary" disabled={busy || draft.name.trim() === '' || draft.baseUrl.trim() === '' || draft.apiKey.trim() === ''} onClick={() => void saveDraft()} type="button">{busy ? '保存中…' : '保存'}</button></footer>
          </div>
        </div>
      )}
    </section>
  )
}
