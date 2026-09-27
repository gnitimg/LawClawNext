import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { friendlyErrorText } from '../friendly-error'
import { displaySkill } from '../skill-presentation'
import { useApp } from '../store'
import type { DesktopModelProvider, LawClawAgent, LawClawSkill, RuntimeConfigStatus } from '../types'
import { Icon } from './Icon'
import { SettingsSelect } from './SettingsSelect'

const STEP_DRAG_TYPE = 'application/x-lawclaw-workflow-step'
const EDGE_DRAG_TYPE = 'application/x-lawclaw-workflow-edge'

const mandatorySkills: Readonly<Record<string, readonly string[]>> = {
  main: ['lawclaw-delivery-protocol'],
  lawyer: ['lawclaw-lawyer-rules', 'lawclaw-delivery-protocol'],
  'reviewer-opponents': ['lawclaw-review-opponents', 'lawclaw-delivery-protocol'],
  'reviewer-judge': ['lawclaw-review-judge', 'lawclaw-delivery-protocol'],
  troubleshooter: ['lawclaw-troubleshooter'],
}

function stepName(agent: LawClawAgent): string {
  if (agent.id === 'main') return '总控仲裁'
  if (agent.id === 'troubleshooter') return '修复诊断'
  return agent.name.replace(/\s*Agent$/u, '')
}

function ordered(agents: readonly LawClawAgent[]): LawClawAgent[] {
  return [...agents].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'zh-CN'))
}

interface EdgePath {
  key: string
  path: string
}

export function WorkflowSettingsPane({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const pushToast = useApp((state) => state.pushToast)
  const [agents, setAgents] = useState<LawClawAgent[]>([])
  const [providers, setProviders] = useState<DesktopModelProvider[]>([])
  const [skills, setSkills] = useState<LawClawSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeConfigStatus>()
  const [draggingStep, setDraggingStep] = useState<string>()
  const [connectFrom, setConnectFrom] = useState<string>()
  const [skillEditor, setSkillEditor] = useState<string>()
  const [skillQuery, setSkillQuery] = useState('')
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([])
  const graphRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      window.desktop.agents.list(),
      window.desktop.models.providers.read(),
      window.desktop.skills.list(),
      window.desktop.runtime.configStatus(),
    ]).then(([nextAgents, nextProviders, nextSkills, status]) => {
      if (!active) return
      setAgents(nextAgents)
      setProviders(nextProviders)
      setSkills(nextSkills)
      setRuntimeStatus(status)
    }).catch((reason: unknown) => {
      if (active) pushToast('error', friendlyErrorText(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    const unsubscribe = window.desktop.runtime.onConfigStatus((status) => {
      if (!status.scopes.includes('agents')) return
      setRuntimeStatus(status)
      if (status.status === 'applied') pushToast('success', '工作流已应用')
      if (status.status === 'error') pushToast('error', friendlyErrorText(status.message))
    })
    return () => { active = false; unsubscribe() }
  }, [])

  const sortedAgents = useMemo(() => ordered(agents), [agents])
  const skillsById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills])
  const edgeCount = agents.reduce((total, agent) => total + agent.nextAgents.length, 0)

  useLayoutEffect(() => {
    const graph = graphRef.current
    if (graph === null) return
    const update = (): void => {
      const graphRect = graph.getBoundingClientRect()
      const paths: EdgePath[] = []
      for (const source of agents) {
        const sourceElement = rowRefs.current.get(source.id)
        if (sourceElement === undefined) continue
        const outputPort = sourceElement.querySelector<HTMLElement>('.workflow-port-output')
        if (outputPort === null) continue
        const sourceRect = outputPort.getBoundingClientRect()
        for (const targetId of source.nextAgents) {
          const targetElement = rowRefs.current.get(targetId)
          if (targetElement === undefined) continue
          const inputPort = targetElement.querySelector<HTMLElement>('.workflow-port-input')
          if (inputPort === null) continue
          const targetRect = inputPort.getBoundingClientRect()
          const x1 = sourceRect.left - graphRect.left + sourceRect.width / 2
          const y1 = sourceRect.top - graphRect.top + sourceRect.height / 2
          const x2 = targetRect.left - graphRect.left + targetRect.width / 2
          const y2 = targetRect.top - graphRect.top + targetRect.height / 2
          const laneX = Math.max(8, Math.min(x1, x2) - 25 - (paths.length % 5) * 7)
          paths.push({
            key: `${source.id}:${targetId}`,
            path: `M ${String(x1)} ${String(y1)} C ${String(laneX)} ${String(y1)}, ${String(laneX)} ${String(y2)}, ${String(x2)} ${String(y2)}`,
          })
        }
      }
      setEdgePaths(paths)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(graph)
    for (const element of rowRefs.current.values()) observer.observe(element)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [agents, skillEditor])

  function patchAgent(id: string, patch: Partial<LawClawAgent>): void {
    setAgents((current) => current.map((agent) => agent.id === id ? { ...agent, ...patch } : agent))
  }

  function moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return
    setAgents((current) => {
      const list = ordered(current)
      const sourceIndex = list.findIndex((agent) => agent.id === sourceId)
      const targetIndex = list.findIndex((agent) => agent.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return current
      const [source] = list.splice(sourceIndex, 1)
      list.splice(targetIndex, 0, source)
      return list.map((agent, index) => ({ ...agent, order: index }))
    })
  }

  function reaches(start: string, goal: string, graph: readonly LawClawAgent[]): boolean {
    const seen = new Set<string>()
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined || seen.has(current)) continue
      if (current === goal) return true
      seen.add(current)
      queue.push(...(graph.find((agent) => agent.id === current)?.nextAgents ?? []))
    }
    return false
  }

  function connect(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      pushToast('error', '步骤不能连接到自身')
      return
    }
    if (agents.find((agent) => agent.id === sourceId)?.nextAgents.includes(targetId) === true) {
      setConnectFrom(undefined)
      return
    }
    if (reaches(targetId, sourceId, agents)) {
      pushToast('error', '这条连线会形成循环，请先调整现有连线')
      return
    }
    setAgents((current) => current.map((agent) => agent.id === sourceId
      ? { ...agent, nextAgents: [...agent.nextAgents, targetId] }
      : agent))
    setConnectFrom(undefined)
  }

  function removeConnection(sourceId: string, targetId: string): void {
    setAgents((current) => current.map((agent) => agent.id === sourceId
      ? { ...agent, nextAgents: agent.nextAgents.filter((id) => id !== targetId) }
      : agent))
  }

  function toggleSkill(agent: LawClawAgent, skillId: string): void {
    const required = mandatorySkills[agent.id]?.includes(skillId) === true
    if (required && agent.skills.includes(skillId)) return
    patchAgent(agent.id, {
      skills: agent.skills.includes(skillId)
        ? agent.skills.filter((id) => id !== skillId)
        : [...agent.skills, skillId],
    })
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      setAgents(await window.desktop.agents.save(ordered(agents).map((agent, index) => ({ ...agent, order: index }))))
    } catch (reason) {
      pushToast('error', friendlyErrorText(reason))
    } finally {
      setSaving(false)
    }
  }

  const editingAgent = agents.find((agent) => agent.id === skillEditor)
  const visibleSkills = skills.filter((skill) => {
    const query = skillQuery.trim().toLocaleLowerCase()
    if (query === '') return true
    const display = displaySkill(skill)
    return `${display.name} ${display.description}`.toLocaleLowerCase().includes(query)
  })

  return (
    <section className={`${embedded ? 'workflow-automation-pane' : 'settings-pane'} workflow-settings-pane`}>
      {!embedded && <div className="settings-section-copy"><span className="eyebrow">CASE WORKFLOW</span><h2>协作工作流</h2></div>}
      <div className="settings-content-box workflow-settings-box">
        <header className="workflow-toolbar">
          <div><strong>{sortedAgents.length} 个步骤</strong><span>{edgeCount} 条连线</span></div>
          <span className="workflow-hint"><Icon name="branch" size={16} />拖动左侧排序，拖拽端点连线</span>
        </header>

        {loading && <div className="workflow-loading"><span className="mini-spinner" />正在读取工作流…</div>}
        {!loading && (
          <div className={`workflow-graph ${connectFrom === undefined ? '' : 'is-connecting'}`} ref={graphRef}>
            <svg aria-hidden="true" className="workflow-edge-layer">
              <defs><marker id="workflow-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0 0 7 3.5 0 7z" /></marker></defs>
              {edgePaths.map((edge) => <path d={edge.path} key={edge.key} markerEnd="url(#workflow-arrow)" />)}
            </svg>
            {sortedAgents.map((agent, index) => {
              const provider = providers.find((item) => item.enabled && item.route === agent.provider)
              const models = provider?.models.filter((model) => model.enabled) ?? []
              const assigned = agent.skills.map((id) => skillsById.get(id)).filter((skill): skill is LawClawSkill => skill !== undefined)
              return (
                <div
                  className={`workflow-step-shell ${draggingStep === agent.id ? 'is-dragging' : ''}`}
                  key={agent.id}
                  onDragOver={(event) => { if (event.dataTransfer.types.includes(STEP_DRAG_TYPE)) event.preventDefault() }}
                  onDrop={(event) => {
                    const sourceId = event.dataTransfer.getData(STEP_DRAG_TYPE)
                    if (sourceId !== '') moveStep(sourceId, agent.id)
                    setDraggingStep(undefined)
                  }}
                >
                  <article className={`workflow-step ${agent.enabled ? '' : 'is-disabled'}`} ref={(element) => { if (element === null) rowRefs.current.delete(agent.id); else rowRefs.current.set(agent.id, element) }}>
                    <button
                      aria-label={`拖动 ${stepName(agent)} 排序`}
                      className="workflow-drag-handle"
                      draggable
                      onDragEnd={() => setDraggingStep(undefined)}
                      onDragStart={(event) => { event.dataTransfer.setData(STEP_DRAG_TYPE, agent.id); event.dataTransfer.effectAllowed = 'move'; setDraggingStep(agent.id) }}
                      type="button"
                    ><Icon name="menu" size={18} /></button>
                    <span className="workflow-step-index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="workflow-step-identity"><strong>{stepName(agent)}</strong><small>{agent.role}</small></div>
                    <label className="workflow-field"><span>提供商</span><SettingsSelect ariaLabel={`${stepName(agent)}提供商`} onChange={(value) => patchAgent(agent.id, { provider: value, model: '' })} options={[{ value: '', label: '未配置' }, ...providers.filter((item) => item.enabled).map((item) => ({ value: item.route, label: item.name }))]} value={provider?.route ?? ''} /></label>
                    <label className="workflow-field"><span>模型</span><SettingsSelect ariaLabel={`${stepName(agent)}模型`} disabled={provider === undefined} onChange={(value) => patchAgent(agent.id, { model: value })} options={[{ value: '', label: '继承全局模型' }, ...models.map((model) => ({ value: model.id, label: model.name }))]} value={models.some((model) => model.id === agent.model) ? agent.model : ''} /></label>
                    <div className="workflow-skill-field"><span>技能</span><button className="workflow-skill-trigger" onClick={() => { setSkillEditor(skillEditor === agent.id ? undefined : agent.id); setSkillQuery('') }} type="button"><span>{assigned.slice(0, 2).map((skill) => displaySkill(skill).name).join('、') || '未选择'}</span>{assigned.length > 2 && <b>+{assigned.length - 2}</b>}<Icon name="chevron-down" size={14} /></button></div>
                    <button aria-checked={agent.enabled} aria-label={`${stepName(agent)}${agent.enabled ? '已启用' : '已停用'}`} className={`settings-toggle ${agent.enabled ? 'is-on' : ''}`} onClick={() => patchAgent(agent.id, { enabled: !agent.enabled })} role="switch" type="button"><span /></button>
                    <button
                      aria-label={`连接到 ${stepName(agent)}`}
                      className={`workflow-port workflow-port-input ${connectFrom !== undefined ? 'is-ready' : ''}`}
                      onClick={() => { if (connectFrom !== undefined) connect(connectFrom, agent.id) }}
                      onDragOver={(event) => { if (event.dataTransfer.types.includes(EDGE_DRAG_TYPE)) event.preventDefault() }}
                      onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData(EDGE_DRAG_TYPE); if (sourceId !== '') connect(sourceId, agent.id) }}
                      title="输入端点"
                      type="button"
                    />
                    <button
                      aria-label={`从 ${stepName(agent)} 开始连线`}
                      className={`workflow-port workflow-port-output ${connectFrom === agent.id ? 'is-active' : ''}`}
                      draggable
                      onClick={() => setConnectFrom(connectFrom === agent.id ? undefined : agent.id)}
                      onDragEnd={() => setConnectFrom(undefined)}
                      onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(EDGE_DRAG_TYPE, agent.id); event.dataTransfer.effectAllowed = 'link'; setConnectFrom(agent.id) }}
                      title="输出端点"
                      type="button"
                    />
                  </article>
                  {agent.nextAgents.length > 0 && <div className="workflow-next-list"><span>下一步</span>{agent.nextAgents.map((targetId) => <button key={targetId} onClick={() => removeConnection(agent.id, targetId)} type="button">{stepName(agents.find((item) => item.id === targetId) ?? agent)}<Icon name="close" size={12} /></button>)}</div>}
                  {skillEditor === agent.id && editingAgent !== undefined && (
                    <div className="workflow-skill-editor">
                      <div className="workflow-skill-editor-head"><strong>选择技能</strong><label><Icon name="search" size={15} /><input autoFocus onChange={(event) => setSkillQuery(event.target.value)} placeholder="搜索技能" value={skillQuery} /></label><button aria-label="关闭技能选择" onClick={() => setSkillEditor(undefined)} type="button"><Icon name="close" size={16} /></button></div>
                      <div className="workflow-skill-grid">
                        {visibleSkills.map((skill) => {
                          const display = displaySkill(skill)
                          const checked = editingAgent.skills.includes(skill.id)
                          const required = mandatorySkills[editingAgent.id]?.includes(skill.id) === true
                          return <button aria-pressed={checked} className={checked ? 'is-selected' : ''} key={skill.id} onClick={() => toggleSkill(editingAgent, skill.id)} type="button"><span className="workflow-skill-check">{checked && <Icon name="check" size={13} />}</span><span><strong>{display.name}</strong><small>{display.description}</small></span>{required && <em>必需</em>}</button>
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <footer className="workflow-footer">
          <span>{runtimeStatus?.status === 'applying' && <><span className="mini-spinner" />正在应用配置…</>}</span>
          <button className="button button-primary" disabled={loading || saving} onClick={() => void save()} type="button">{saving ? '保存中…' : '保存工作流'}</button>
        </footer>
      </div>
    </section>
  )
}
