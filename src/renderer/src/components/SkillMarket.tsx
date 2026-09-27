import { useEffect, useMemo, useState } from 'react'
import { displaySkill } from '../skill-presentation'
import type { LawClawSkill } from '../types'
import { Icon } from './Icon'

type Status = 'loading' | 'ready' | 'error'
type SkillCategory = LawClawSkill['category'] | 'all'

const categoryLabels: Record<SkillCategory, string> = {
  all: '全部',
  legal: '法律工作',
  privacy: '隐私安全',
  documents: '材料处理',
  operations: '运行维护',
}

export function SkillMarket(): React.ReactElement {
  const [skills, setSkills] = useState<LawClawSkill[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SkillCategory>('all')
  const [busySkill, setBusySkill] = useState<string | undefined>()

  function load(): void {
    setStatus('loading')
    setError(undefined)
    void window.desktop.skills.list()
      .then((items) => {
        setSkills(items)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setStatus('error')
      })
  }

  useEffect(load, [])

  async function toggleSkill(skill: LawClawSkill): Promise<void> {
    if (busySkill !== undefined) return
    const previous = skills
    const enabled = !skill.enabled
    setBusySkill(skill.id)
    setError(undefined)
    setSkills((current) => current.map((item) => item.id === skill.id ? { ...item, enabled } : item))
    try {
      setSkills(await window.desktop.skills.setEnabled(skill.id, enabled))
    } catch (reason) {
      setSkills(previous)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusySkill(undefined)
    }
  }

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return skills.filter((skill) => {
      if (category !== 'all' && skill.category !== category) return false
      if (needle === '') return true
      const display = displaySkill(skill)
      return display.name.toLocaleLowerCase().includes(needle)
        || display.description.toLocaleLowerCase().includes(needle)
        || skill.id.toLocaleLowerCase().includes(needle)
    })
  }, [category, query, skills])

  const enabledCount = skills.filter((skill) => skill.enabled).length

  return (
    <div className="surface-view plugin-view skill-market-view">
      <header className="surface-header titlebar-drag">
        <div className="surface-heading">
          <h1>技能管理</h1>
        </div>
        <div className="header-actions titlebar-no-drag">
          <span className="market-count">{enabledCount} / {skills.length} 个技能已启用</span>
          <button aria-label="刷新技能" className="icon-button" onClick={load} type="button"><Icon name="refresh" size={16} /></button>
        </div>
      </header>

      <div className="plugin-canvas skill-canvas">
        <div className="management-toolbar skill-market-toolbar">
          <span className="scope-chip"><Icon name="monitor" size={14} />本机</span>
          <span className="management-count">共 {skills.length} 项</span>
          <div className="market-search">
            <Icon name="search" size={17} />
            <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能或能力…" value={query} />
            {query !== '' && <button aria-label="清除搜索" onClick={() => setQuery('')} type="button"><Icon name="close" size={14} /></button>}
          </div>
          <div className="skill-category-tabs" role="tablist" aria-label="技能分类">
            {(Object.keys(categoryLabels) as SkillCategory[]).map((item) => (
              <button aria-selected={category === item} className={category === item ? 'is-active' : ''} key={item} onClick={() => setCategory(item)} role="tab" type="button">{categoryLabels[item]}</button>
            ))}
          </div>
        </div>

        {error !== undefined && <div className="installed-plugin-error" role="alert"><Icon name="activity" size={15} /><span>{error}</span></div>}

        {status === 'loading' && (
          <div className="management-list">
            {Array.from({ length: 4 }, (_, index) => <div className="management-row plugin-skeleton" key={index}><span /><span /><span /></div>)}
          </div>
        )}

        {status === 'error' && (
          <div className="market-empty"><span className="market-empty-icon"><Icon name="activity" /></span><h3>无法读取技能目录</h3><p>{error}</p><button className="button" onClick={load} type="button"><Icon name="refresh" size={15} />重试</button></div>
        )}

        {status === 'ready' && visibleSkills.length === 0 && (
          <div className="market-empty"><span className="market-empty-icon"><Icon name="search" /></span><h3>没有匹配的技能</h3><p>尝试切换分类或使用更短的关键词。</p></div>
        )}

        {status === 'ready' && visibleSkills.length > 0 && (
          <section className="capability-admin">
            <div className="management-section-title"><span>已安装</span><b>{visibleSkills.length}</b></div>
            <div className="management-list capability-list">
            {visibleSkills.map((skill) => {
              const display = displaySkill(skill)
              return <article className={`management-row capability-row ${skill.enabled ? 'is-enabled' : ''}`} key={skill.id}>
                <span className="management-row-icon"><Icon name={skill.category === 'privacy' ? 'shield' : skill.category === 'documents' ? 'folder' : skill.category === 'operations' ? 'activity' : 'sparkles'} size={18} /></span>
                <div className="capability-copy"><strong>{display.name}</strong><small>{display.description}</small></div>
                  <button
                    aria-pressed={skill.enabled}
                    aria-label={skill.enabled ? `停用 ${display.name}` : `启用 ${display.name}`}
                    className={`settings-toggle ${skill.enabled ? 'is-on' : ''}`}
                    disabled={busySkill !== undefined}
                    onClick={() => void toggleSkill(skill)}
                    type="button"
                  >
                    <span />
                  </button>
              </article>
            })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
