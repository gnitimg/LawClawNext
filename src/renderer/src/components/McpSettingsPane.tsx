import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import type { McpServerConfig } from '../types'
import { friendlyErrorText } from '../friendly-error'
import { Icon } from './Icon'

function emptyServer(): McpServerConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    serverName: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: [],
    cwd: '',
    env: {},
    url: '',
    headers: {},
    toolCallTimeoutMs: 60_000,
  }
}

function linesOf(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
}

function mapOf(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=')
    return separator < 1 ? [line, ''] : [line.slice(0, separator).trim(), line.slice(separator + 1)]
  }))
}

export function McpSettingsPane(): React.ReactElement {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [draft, setDraft] = useState<McpServerConfig | undefined>()
  const [envText, setEnvText] = useState('')
  const [headerText, setHeaderText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [query, setQuery] = useState('')
  const pushToast = useApp((state) => state.pushToast)

  function toastError(reason: unknown): void {
    pushToast('error', friendlyErrorText(reason))
  }

  function load(): void {
    setLoading(true)
    void window.desktop.mcp.read()
      .then(setServers)
      .catch(toastError)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const visibleServers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle === '' ? servers : servers.filter((server) => `${server.name} ${server.serverName} ${server.command} ${server.url}`.toLocaleLowerCase().includes(needle))
  }, [query, servers])

  function edit(server: McpServerConfig): void {
    setDraft({ ...server, args: [...server.args], env: { ...server.env }, headers: { ...server.headers } })
    setEnvText(linesOf(server.env))
    setHeaderText(linesOf(server.headers))
  }

  function keepDraft(): void {
    if (draft === undefined) return
    const next = { ...draft, env: mapOf(envText), headers: mapOf(headerText) }
    setServers((current) => [...current.filter((server) => server.id !== next.id), next])
    setDraft(undefined)
    pushToast('success', '修改已暂存；点击“保存并应用”后才会重启能力服务。')
  }

  async function testDraft(): Promise<void> {
    if (draft === undefined) return
    setTesting(true)
    try {
      const result = await window.desktop.mcp.test({ ...draft, env: mapOf(envText), headers: mapOf(headerText) })
      pushToast('success', `${result.message}${result.tools.length > 0 ? ` ${result.tools.join('、')}` : ''}`)
    } catch (reason) {
      toastError(reason)
    } finally {
      setTesting(false)
    }
  }

  async function saveAll(): Promise<void> {
    setSaving(true)
    try {
      const saved = await window.desktop.mcp.save(servers)
      setServers(saved)
      pushToast('success', 'MCP 配置已加密保存并应用；新会话会看到已启用服务器的工具。')
    } catch (reason) {
      toastError(reason)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-pane mcp-admin">
      <div className="management-heading"><div><span className="eyebrow">MODEL CONTEXT PROTOCOL</span><h2>MCP 服务</h2><p>连接本地程序或远程服务，并管理 Agent 可调用的工具。</p></div><button className="button button-primary" disabled={loading || draft !== undefined} onClick={() => edit(emptyServer())} type="button"><Icon name="plus" size={15} />新建 MCP 服务</button></div>
      <div className="management-toolbar">
        <span className="scope-chip"><Icon name="monitor" size={14} />本机</span>
        <span className="management-count">MCP {servers.length}</span>
        <label className="management-search"><Icon name="search" size={15} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索 MCP 服务…" value={query} /></label>
        <button aria-label="刷新" className="icon-button subtle" onClick={load} type="button"><Icon name="refresh" size={15} /></button>
      </div>
      <div className="management-security-note"><Icon name="shield" size={14} /><span>凭证使用系统安全存储加密；仅启用可信服务。</span></div>

      <div className="management-section-title"><span>已配置</span><b>{visibleServers.length}</b></div>

      {servers.length === 0 && !loading
        ? <div className="management-empty"><span><Icon name="link" size={22} /></span><strong>尚未安装 MCP 服务</strong><small>连接本地 stdio 程序或远程 Streamable HTTP 服务。</small><button className="button button-primary" onClick={() => edit(emptyServer())} type="button"><Icon name="plus" size={14} />新建 MCP 服务</button></div>
        : <div className="management-list mcp-server-list">{visibleServers.map((server) => (
          <div className="management-row mcp-server-row" key={server.id}>
            <span className="management-row-icon"><Icon name={server.transport === 'stdio' ? 'terminal' : 'globe'} size={17} /></span>
            <div><strong>{server.name || server.serverName}</strong><small>{server.transport === 'stdio' ? `本地 stdio · ${server.command}` : `远程 HTTP · ${server.url}`}</small></div>
            <code>{server.serverName}</code>
            <button aria-label={server.enabled ? '停用' : '启用'} className={`settings-toggle ${server.enabled ? 'is-on' : ''}`} onClick={() => setServers((current) => current.map((item) => item.id === server.id ? { ...item, enabled: !item.enabled } : item))} type="button"><span /></button>
            <button className="icon-button subtle" onClick={() => edit(server)} type="button"><Icon name="edit" size={14} /></button>
            <button className="icon-button subtle danger-text" onClick={() => setServers((current) => current.filter((item) => item.id !== server.id))} type="button"><Icon name="trash" size={14} /></button>
          </div>
        ))}</div>}

      {draft !== undefined && (
        <div className="settings-card mcp-editor">
          <div className="ocr-cloud-heading"><Icon name="link" size={18} /><div><strong>{servers.some((server) => server.id === draft.id) ? '编辑 MCP 服务' : '添加 MCP 服务'}</strong><small>先测试连接，再保存并应用到 DSH。</small></div></div>
          <div className="ocr-grid-fields">
            <label><span>显示名称</span><input onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：内部法规库" value={draft.name} /></label>
            <label><span>服务标识</span><input onChange={(event) => setDraft({ ...draft, serverName: event.target.value })} placeholder="例如：regulations" spellCheck={false} value={draft.serverName} /></label>
          </div>
          <div className="ocr-mode-switch compact" role="group" aria-label="MCP 传输方式">
            <button className={draft.transport === 'stdio' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, transport: 'stdio' })} type="button"><Icon name="terminal" size={16} /><span><strong>本地 stdio</strong><small>启动本机 MCP 程序</small></span></button>
            <button className={draft.transport === 'streamable-http' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, transport: 'streamable-http' })} type="button"><Icon name="globe" size={16} /><span><strong>远程 HTTP</strong><small>连接 HTTPS MCP 地址</small></span></button>
          </div>
          {draft.transport === 'stdio' ? <>
            <label className="field"><span>启动命令</span><input onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="例如：npx.cmd" spellCheck={false} value={draft.command} /></label>
            <label className="field"><span>参数 <small>每行一个参数</small></span><textarea onChange={(event) => setDraft({ ...draft, args: event.target.value.split(/\r?\n/u) })} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\Cases'} rows={4} value={draft.args.join('\n')} /></label>
            <label className="field"><span>工作目录 <small>可选</small></span><input onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} spellCheck={false} value={draft.cwd} /></label>
            <label className="field"><span>环境变量 <small>每行 KEY=VALUE；保存时加密</small></span><textarea onChange={(event) => setEnvText(event.target.value)} placeholder="ACCESS_TOKEN=…" rows={4} value={envText} /></label>
          </> : <>
            <label className="field"><span>Streamable HTTP 地址</span><input onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/mcp" type="url" value={draft.url} /></label>
            <label className="field"><span>请求头 <small>每行 Header=Value；保存时加密</small></span><textarea onChange={(event) => setHeaderText(event.target.value)} placeholder="Authorization=Bearer …" rows={4} value={headerText} /></label>
          </>}
          <label className="field"><span>单次工具调用超时（毫秒）</span><input max={300000} min={1000} onChange={(event) => setDraft({ ...draft, toolCallTimeoutMs: Number(event.target.value) })} type="number" value={draft.toolCallTimeoutMs} /></label>
          <div className="settings-card-actions">
            <button className="button" onClick={() => setDraft(undefined)} type="button">取消</button>
            <button className="button" disabled={testing} onClick={() => void testDraft()} type="button">{testing ? '正在连接…' : '测试连接'}</button>
            <button className="button button-primary" onClick={keepDraft} type="button">暂存此服务</button>
          </div>
        </div>
      )}

      <div className="settings-card-actions mcp-save-actions">
        <button className="button button-primary" disabled={saving || loading || draft !== undefined} onClick={() => void saveAll()} type="button">{saving ? '正在重启能力服务…' : '保存并应用'}</button>
      </div>
    </section>
  )
}
