import { app } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readModelProviders, type DesktopModelProvider } from './model-providers'
import { discoverLawClawSkills } from './skill-catalog'

export interface LawClawAgent {
  id: string
  name: string
  role: string
  description: string
  enabled: boolean
  provider: string
  model: string
  skills: string[]
  order: number
  nextAgents: string[]
}

export const DEFAULT_LAWCLAW_AGENTS: readonly LawClawAgent[] = [
  { id: 'main', name: '总控 Agent', role: '流程编排与最终仲裁', description: '组织案件任务、协调各专业 Agent，并汇总最终结论。', enabled: true, provider: '', model: '', skills: ['lawclaw-case-privacy', 'lawclaw-material-extraction', 'lawclaw-cleanup-rules', 'lawclaw-delivery-protocol', 'legal-assistant', 'case-preprocess', 'evidence-directory', 'json-canvas'], order: 4, nextAgents: [] },
  { id: 'lawyer', name: '主办律师 Agent', role: '案件分析与文书起草', description: '研读材料、形成诉讼策略并起草正式交付文件。', enabled: true, provider: '', model: '', skills: ['lawclaw-case-privacy', 'lawclaw-material-extraction', 'lawclaw-delivery-protocol', 'lawclaw-lawyer-rules', 'legal-assistant', 'legal-analysis-quality', 'civil-defense-statement', 'evidence-directory', 'opponent-prediction', 'json-canvas'], order: 0, nextAgents: ['reviewer-opponents', 'reviewer-judge'] },
  { id: 'reviewer-opponents', name: '对方律师审查 Agent', role: '对抗式复核', description: '从对方律师视角寻找证据、论证与程序弱点。', enabled: true, provider: '', model: '', skills: ['lawclaw-delivery-protocol', 'lawclaw-review-opponents', 'legal-analysis-quality', 'evidence-directory', 'opponent-prediction', 'json-canvas'], order: 1, nextAgents: ['main'] },
  { id: 'reviewer-judge', name: '法官审查 Agent', role: '裁判视角复核', description: '从证据采信、法律适用和裁判说理角度独立审查。', enabled: true, provider: '', model: '', skills: ['lawclaw-delivery-protocol', 'lawclaw-review-judge', 'legal-analysis-quality', 'legal-article-verify', 'evidence-directory', 'json-canvas'], order: 2, nextAgents: ['main'] },
  { id: 'troubleshooter', name: '修理工 Agent', role: '运行诊断与恢复建议', description: '定位失败原因，给出低风险、可回滚的恢复路径。', enabled: true, provider: '', model: '', skills: ['lawclaw-troubleshooter', 'lawclaw-cleanup-rules'], order: 3, nextAgents: ['main'] },
]

const personas: Readonly<Record<string, string>> = {
  lawyer: '你是案件主办律师。仅依据当前案件材料分析事实、证据和法律问题，并起草可交付文书；明确区分已证实事实、当事人陈述与待核实事项，不得虚构。必须读取并遵循 lawclaw-lawyer-rules 与 lawclaw-delivery-protocol，生成有效 Canvas，并以实际 Agent 名称和当前 provider/model 亲自署名。',
  'reviewer-opponents': '你是对方律师审查 Agent。独立审查 Main 指定的冻结版本，不得读取或推测另一审查者尚未提交的结论。必须读取并遵循 lawclaw-review-opponents 与 lawclaw-delivery-protocol，详细理由写入审查报告，正式文书只写紧凑核验戳，并以自己的实际 provider/model 署名。',
  'reviewer-judge': '你是法官审查 Agent。独立审查 Main 指定的冻结版本，不得读取或推测另一审查者尚未提交的结论。必须读取并遵循 lawclaw-review-judge 与 lawclaw-delivery-protocol，详细理由写入审查报告，正式文书只写紧凑核验戳，并以自己的实际 provider/model 署名。',
  troubleshooter: '你是 LawClaw 修理工 Agent。必须读取并遵循 lawclaw-troubleshooter。只诊断失败原因并提出低风险、可回滚的恢复选项；未经用户明确授权不得取消或重启任务、修改文件或配置、移动案件材料、替换凭证或改写正式交付。',
}

const MANDATORY_AGENT_SKILLS: Readonly<Record<string, readonly string[]>> = {
  main: ['lawclaw-delivery-protocol'],
  lawyer: ['lawclaw-lawyer-rules', 'lawclaw-delivery-protocol'],
  'reviewer-opponents': ['lawclaw-review-opponents', 'lawclaw-delivery-protocol'],
  'reviewer-judge': ['lawclaw-review-judge', 'lawclaw-delivery-protocol'],
  troubleshooter: ['lawclaw-troubleshooter'],
}

const tools: Readonly<Record<string, string>> = {
  lawyer: 'delegate_lawyer',
  'reviewer-opponents': 'delegate_opposing_counsel',
  'reviewer-judge': 'delegate_judge',
  troubleshooter: 'delegate_troubleshooter',
}

function usableProviders(providers: readonly DesktopModelProvider[]): DesktopModelProvider[] {
  return providers.filter((provider) => provider.enabled && provider.models.some((model) => model.enabled))
}

export function normalizeAgents(
  value: unknown,
  skillIds: ReadonlySet<string>,
  providers: readonly DesktopModelProvider[] = [],
): LawClawAgent[] {
  const incoming = Array.isArray(value) ? value : []
  const usable = usableProviders(providers)
  const fallbackProvider = usable[0]
  const normalized = DEFAULT_LAWCLAW_AGENTS.map((base) => {
    const candidate = incoming.find((item): item is Record<string, unknown> => (
      typeof item === 'object' && item !== null && (item as Record<string, unknown>).id === base.id
    ))
    const requestedProvider = candidate !== undefined && typeof candidate.provider === 'string'
      ? candidate.provider.trim()
      : base.provider
    const provider = usable.find((item) => item.route === requestedProvider) ?? fallbackProvider
    const enabledModels = provider?.models.filter((model) => model.enabled) ?? []
    const requestedModel = candidate !== undefined && typeof candidate.model === 'string'
      ? candidate.model.trim()
      : base.model
    const model = enabledModels.some((item) => item.id === requestedModel)
      ? requestedModel
      : enabledModels[0]?.id ?? ''
    const configuredSkills = candidate !== undefined && Array.isArray(candidate.skills)
      ? candidate.skills.filter((item): item is string => typeof item === 'string' && skillIds.has(item))
      : [...base.skills]
    const skills = [...new Set([
      ...configuredSkills,
      ...(MANDATORY_AGENT_SKILLS[base.id] ?? []).filter((skill) => skillIds.has(skill)),
    ])]
    const order = candidate !== undefined && typeof candidate.order === 'number' && Number.isFinite(candidate.order)
      ? Math.max(0, Math.min(DEFAULT_LAWCLAW_AGENTS.length - 1, Math.round(candidate.order)))
      : base.order
    const nextAgents = candidate !== undefined && Array.isArray(candidate.nextAgents)
      ? candidate.nextAgents.filter((item): item is string => typeof item === 'string')
      : [...base.nextAgents]
    return {
      ...base,
      enabled: candidate !== undefined && typeof candidate.enabled === 'boolean' ? candidate.enabled : base.enabled,
      provider: provider?.route ?? '',
      model,
      skills,
      order,
      nextAgents,
    }
  })
  const agentIds = new Set(normalized.map((agent) => agent.id))
  return normalized.map((agent) => ({
    ...agent,
    nextAgents: [...new Set(agent.nextAgents.filter((id) => id !== agent.id && agentIds.has(id)))],
  }))
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

function storedAgents(): unknown {
  try {
    const value = JSON.parse(readFileSync(resolve(app.getPath('userData'), 'lawclaw-next.json'), 'utf8')) as { agents?: unknown }
    return value.agents
  } catch {
    return undefined
  }
}

function installedSkillIds(): ReadonlySet<string> {
  try {
    const resourceRoot = app.isPackaged
      ? resolve(process.resourcesPath, 'lawclaw')
      : resolve(app.getAppPath(), 'resources/lawclaw')
    return new Set(discoverLawClawSkills(resourceRoot).map((skill) => skill.id))
  } catch {
    return new Set(DEFAULT_LAWCLAW_AGENTS.flatMap((agent) => agent.skills))
  }
}

export function writeAgentRuntimePatch(dshHome: string): { patchPath?: string } {
  const patchPath = resolve(dshHome, 'agents.patch.yml')
  let providers: DesktopModelProvider[] = []
  try {
    providers = readModelProviders()
  } catch {}
  const agents = normalizeAgents(storedAgents(), installedSkillIds(), providers)
  const orderedAgents = [...agents].sort((left, right) => left.order - right.order)
  const workflowSkillRoot = resolve(dshHome, 'skills', 'lawclaw-workflow-config')
  mkdirSync(workflowSkillRoot, { recursive: true })
  const workflowLines = [
    '---',
    'name: lawclaw-workflow-config',
    'description: Use for every non-trivial LawClaw case to follow the user-configured collaboration route, model bindings, and per-step skills.',
    '---',
    '',
    '# 当前协作工作流',
    '',
    '按下列配置组织任务。连线表示允许的下一步；没有连线不得自行跳转。',
    '该配置不得绕过固定草稿、同一版本双重独立审查、Main 最终仲裁、修复前授权、Canvas 校验和真实模型署名规则。',
    '',
    ...orderedAgents.flatMap((agent, index) => [
      `## ${String(index + 1).padStart(2, '0')} ${agent.name}`,
      `- 状态：${agent.enabled ? '启用' : '停用'}`,
      `- 模型：${agent.provider === '' || agent.model === '' ? '继承或未配置' : `${agent.provider} / ${agent.model}`}`,
      `- 技能：${agent.skills.length === 0 ? '无' : agent.skills.join(', ')}`,
      `- 下一步：${agent.nextAgents.length === 0 ? '结束' : agent.nextAgents.join(', ')}`,
      '',
    ]),
  ]
  writeFileSync(resolve(workflowSkillRoot, 'SKILL.md'), `${workflowLines.join('\n')}\n`, 'utf8')
  const main = agents.find((agent) => agent.id === 'main' && agent.enabled && agent.provider !== '' && agent.model !== '')
  if (main === undefined) {
    rmSync(patchPath, { force: true })
    return {}
  }

  const lines = [
    '# Generated by LawClaw Next. Agent model bindings are applied to new sessions.',
    '- id: agent-default-model',
    '  config:',
    `    provider: ${yaml(main.provider)}`,
    `    model: ${yaml(main.model)}`,
  ]
  for (const agent of agents.filter((item) => item.id !== 'main')) {
    const toolName = tools[agent.id]
    const persona = personas[agent.id]
    if (toolName === undefined || persona === undefined) continue
    const configured = agent.enabled && agent.provider !== '' && agent.model !== ''
    lines.push(`- id: ${agent.id === 'lawyer' ? 'tool-subagent' : `lawclaw-subagent-${agent.id}`}`)
    lines.push("  name: '@deepseek-ai/dsh-tool-subagent'")
    lines.push(`  disabled: ${configured ? 'false' : 'true'}`)
    lines.push('  config:')
    lines.push('    provider: "spawn"')
    lines.push(`    toolName: ${yaml(toolName)}`)
    lines.push('    backgroundMode: "continuable"')
    lines.push('    maxDepth: 1')
    const next = agent.nextAgents.length === 0 ? '完成后返回 Main' : `完成后只可流转到：${agent.nextAgents.join('、')}`
    const assignedSkills = agent.skills.length === 0 ? '本步骤没有额外技能' : `本步骤应按需读取这些技能：${agent.skills.join('、')}`
    lines.push(`    persona: ${yaml(`${persona} ${assignedSkills}。${next}。`)}`)
    if (configured) {
      lines.push('    agentOptions:')
      lines.push(`      provider: ${yaml(agent.provider)}`)
      lines.push(`      model: ${yaml(agent.model)}`)
    }
  }
  writeFileSync(patchPath, `${lines.join('\n')}\n`, 'utf8')
  return { patchPath }
}
