import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export type LawClawSkillCategory = 'legal' | 'privacy' | 'documents' | 'operations'

export interface LawClawSkill {
  id: string
  name: string
  description: string
  category: LawClawSkillCategory
  version: string
  source: 'lawclaw'
  entrypoints: string[]
  compatibleAgents: string[]
}

const LEGAL_SKILLS = new Set([
  'civil-appeal',
  'civil-complaint',
  'civil-defense-statement',
  'court-document-handler',
  'evidence-directory',
  'lawclaw-delivery-protocol',
  'lawclaw-lawyer-rules',
  'lawclaw-review-judge',
  'lawclaw-review-opponents',
  'legal-analysis-quality',
  'legal-article-verify',
  'legal-assistant',
  'opponent-prediction',
  'pkulaw-search',
  'trial-outline',
])

const PRIVACY_SKILLS = new Set(['lawclaw-case-privacy', 'lawclient-sensitive-redaction'])

const DOCUMENT_SKILLS = new Set([
  'browser-scraper',
  'case-preprocess',
  'json-canvas',
  'lawclaw-material-extraction',
  'obsidian-bases',
  'obsidian-markdown',
  'rag-knowledge-base',
])

export const DEFAULT_ENABLED_SKILL_IDS = [
  'lawclaw-case-privacy',
  'lawclaw-material-extraction',
  'lawclaw-cleanup-rules',
  'lawclaw-troubleshooter',
  'lawclaw-delivery-protocol',
  'lawclaw-lawyer-rules',
  'lawclaw-review-opponents',
  'lawclaw-review-judge',
  'legal-assistant',
  'legal-analysis-quality',
  'case-preprocess',
  'civil-defense-statement',
  'opponent-prediction',
  'evidence-directory',
  'json-canvas',
] as const

const METADATA: Readonly<Record<string, Partial<LawClawSkill>>> = {
  'lawclaw-case-privacy': {
    name: '案件隐私脱敏',
    description: '在本机完成案件材料脱敏、加密映射与授权恢复，敏感原文不离开设备。',
    category: 'privacy',
    compatibleAgents: ['main', 'lawyer'],
  },
  'lawclaw-material-extraction': {
    name: '法律材料抽取',
    description: '从 PDF、图片与文本材料提取可分析内容，并提供本地 OCR 降级路径。',
    category: 'documents',
    compatibleAgents: ['main', 'lawyer'],
  },
  'lawclaw-troubleshooter': {
    name: 'LawClaw 故障诊断',
    description: '诊断任务、模型绑定、交付、审查与运行时故障，未经授权不实施修复。',
    category: 'operations',
    compatibleAgents: ['troubleshooter'],
  },
  'lawclaw-cleanup-rules': {
    name: '案件清理与留存规则',
    description: '区分正式交付、诊断证据和可回收的运行时中间产物，避免误删案件材料。',
    category: 'operations',
    compatibleAgents: ['main', 'troubleshooter'],
  },
  'lawclaw-delivery-protocol': {
    name: '正式交付与署名协议',
    description: '约束五类正式产物、Canvas JSON、模型署名、双重独立审查和 Main 最终仲裁。',
    category: 'legal',
    compatibleAgents: ['main', 'lawyer', 'reviewer-opponents', 'reviewer-judge'],
  },
  'lawclaw-lawyer-rules': {
    name: '主办律师执业规则',
    description: '保留原 LawClaw 的技能路由、材料优先、法条核验、证据三性、金额计算和审慎起草纪律。',
    category: 'legal',
    compatibleAgents: ['lawyer'],
  },
  'lawclaw-review-opponents': {
    name: '对方律师审查规则',
    description: '从对方律师立场按文书类型执行独立、可追溯的对抗式审查。',
    category: 'legal',
    compatibleAgents: ['reviewer-opponents'],
  },
  'lawclaw-review-judge': {
    name: '法官视角审查规则',
    description: '从裁判视角独立核验诉请、证据、法条、程序和真实风险。',
    category: 'legal',
    compatibleAgents: ['reviewer-judge'],
  },
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function frontmatterValue(content: string, key: string): string {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1] ?? ''
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'imu').exec(frontmatter)
  return match === null ? '' : unquote(match[1])
}

function displayName(id: string, content: string): string {
  const configured = frontmatterValue(content, 'name')
  if (configured !== '') return configured
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim()
  if (heading !== undefined && heading !== '') return heading
  return id
}

function categoryFor(id: string): LawClawSkillCategory {
  if (LEGAL_SKILLS.has(id)) return 'legal'
  if (PRIVACY_SKILLS.has(id)) return 'privacy'
  if (DOCUMENT_SKILLS.has(id)) return 'documents'
  return 'operations'
}

function compatibleAgentsFor(id: string, category: LawClawSkillCategory): string[] {
  if (id === 'lawclaw-troubleshooter') return ['troubleshooter']
  if (id === 'lawclaw-cleanup-rules') return ['main', 'troubleshooter']
  if (category === 'legal') return ['main', 'lawyer', 'reviewer-opponents', 'reviewer-judge']
  if (category === 'operations') return ['main', 'troubleshooter']
  return ['main', 'lawyer']
}

function filesUnder(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.endsWith(':Zone.Identifier')) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  walk(root)
  return files.sort()
}

export function discoverLawClawSkills(resourceRoot: string): LawClawSkill[] {
  const skillsRoot = resolve(resourceRoot, 'skills')
  const skills: LawClawSkill[] = []
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)) continue
    const root = resolve(skillsRoot, entry.name)
    let content = ''
    try {
      content = readFileSync(resolve(root, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const category = categoryFor(entry.name)
    const metadata = METADATA[entry.name] ?? {}
    const description = metadata.description
      ?? frontmatterValue(content, 'description')
      ?? ''
    skills.push({
      id: entry.name,
      name: metadata.name ?? displayName(entry.name, content),
      description,
      category: metadata.category ?? category,
      version: (metadata.version ?? frontmatterValue(content, 'version')) || '1.0.0',
      source: 'lawclaw',
      entrypoints: filesUnder(root).map((path) => `skills/${entry.name}/${path}`),
      compatibleAgents: metadata.compatibleAgents ?? compatibleAgentsFor(entry.name, category),
    })
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}
