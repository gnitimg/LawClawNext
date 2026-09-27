import { useEffect, useMemo, useState } from 'react'
import { displaySkill } from '../skill-presentation'
import type { LawClawSkill } from '../types'
import { Icon } from './Icon'

type SkillCategory = LawClawSkill['category'] | 'all'

const categoryLabels: Record<SkillCategory, string> = {
  all: '全部',
  legal: '法律工作',
  privacy: '隐私安全',
  documents: '材料处理',
  operations: '运行维护',
}

export function SkillSettingsPane(): React.ReactElement {
  const [skills, setSkills] = useState<LawClawSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SkillCategory>('all')
  const [busySkill, setBusySkill] = useState<string | undefined>()

  function load(): void {
    setLoading(true)
    setError(undefined)
    void window.desktop.skills.list()
      .then(setSkills)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return skills.filter((skill) => {
      if (category !== 'all' && skill.category !== category) return false
      if (needle === '') return true
      const display = displaySkill(skill)
      return `${display.name} ${display.description} ${skill.id}`.toLocaleLowerCase().includes(needle)
    })
  }, [category, query, skills])

  async function toggle(skill: LawClawSkill): Promise<void> {
    if (busySkill !== undefined) return
    const previous = skills
    const enabled = !skill.enabled
    setBusySkill(skill.id)
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

  const enabledCount = skills.filter((skill) => skill.enabled).length

  return (
    <section className="settings-pane skill-settings-pane">
      <div className="settings-section-copy"><span className="eyebrow">LAWCLAW SKILLS</span><h2>技能管理</h2></div>
      <div className="settings-content-box skill-settings-box">
        <div className="skill-catalog-summary">
          <span><strong>{skills.length}</strong> 项本地技能</span>
          <span><strong>{enabledCount}</strong> 项已启用</span>
          <button aria-label="刷新技能" className="icon-button subtle" onClick={load} type="button"><Icon name="refresh" size={16} /></button>
        </div>
        <div className="skill-market-toolbar">
          <label className="market-search skill-market-search"><Icon name="search" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能或用途" value={query} />{query !== '' && <button aria-label="清除搜索" onClick={() => setQuery('')} type="button"><Icon name="close" size={14} /></button>}</label>
          <div className="skill-category-tabs" role="tablist" aria-label="技能分类">
            {(Object.keys(categoryLabels) as SkillCategory[]).map((item) => <button aria-selected={category === item} className={category === item ? 'is-active' : ''} key={item} onClick={() => setCategory(item)} role="tab" type="button">{categoryLabels[item]}</button>)}
          </div>
        </div>

        {error !== undefined && <div className="installed-plugin-error" role="alert"><Icon name="activity" size={15} /><span>{error}</span></div>}
        {loading && <div className="skill-settings-loading"><span className="mini-spinner" />正在读取全部技能…</div>}
        {!loading && visibleSkills.length === 0 && <div className="market-empty"><span className="market-empty-icon"><Icon name="search" /></span><h3>没有匹配的技能</h3><p>请切换分类或使用更短的关键词。</p></div>}
        {!loading && visibleSkills.length > 0 && (
          <div className="management-list capability-list">
            {visibleSkills.map((skill) => {
              const display = displaySkill(skill)
              return (
                <article className={`management-row capability-row ${skill.enabled ? 'is-enabled' : ''}`} key={skill.id}>
                  <span className="management-row-icon"><Icon name={skill.category === 'privacy' ? 'shield' : skill.category === 'documents' ? 'folder' : skill.category === 'operations' ? 'activity' : 'sparkles'} size={19} /></span>
                  <div className="capability-copy"><strong>{display.name}</strong><small>{display.description}</small></div>
                  <button aria-busy={busySkill === skill.id} aria-pressed={skill.enabled} aria-label={skill.enabled ? `停用 ${display.name}` : `启用 ${display.name}`} className={`settings-toggle ${skill.enabled ? 'is-on' : ''}`} disabled={busySkill !== undefined && busySkill !== skill.id} onClick={() => void toggle(skill)} type="button"><span /></button>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
