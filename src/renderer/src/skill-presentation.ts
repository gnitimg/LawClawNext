import type { LawClawSkill } from './types'

const localizedSkills: Readonly<Record<string, { name: string, description: string }>> = {
  brainstorming: { name: '方案研讨', description: '在实施前梳理需求、约束、风险与可选方案。' },
  'browser-scraper': { name: '网页材料采集', description: '采集网页正文并整理为可检索的案件材料。' },
  'case-preprocess': { name: '案件材料预处理', description: '整理 PDF、扫描件和案件目录，建立结构化材料基础。' },
  'civil-appeal': { name: '民事上诉状', description: '根据案件事实、证据和上诉请求起草民事上诉状。' },
  'civil-complaint': { name: '民事起诉状', description: '根据案件事实、证据和诉讼请求起草民事起诉状。' },
  'civil-defense-statement': { name: '民事答辩状', description: '逐项回应诉讼请求并形成有依据的答辩意见。' },
  'clawhub-skill-vetting': { name: '技能安全审查', description: '安装或启用技能前检查来源、权限和潜在风险。' },
  'court-document-handler': { name: '法院文书处理', description: '识别、归档并提取法院文书中的关键内容。' },
  'dispatching-parallel-agents': { name: '并行任务分派', description: '把互不依赖的工作拆分并交给多个子任务处理。' },
  'evidence-directory': { name: '证据目录', description: '根据案件材料生成规范、可核对的证据目录。' },
  'executing-plans': { name: '执行计划', description: '按照已确认的实施计划逐步完成工作并记录结果。' },
  'find-skills': { name: '技能查找', description: '从已安装能力中查找最适合当前任务的技能。' },
  'finishing-a-development-branch': { name: '开发分支收尾', description: '在开发完成后执行验证、整理和合并前检查。' },
  'json-canvas': { name: '知识图谱画布', description: '创建和校验 Obsidian Canvas 格式的案件知识图谱。' },
  'lawclient-sensitive-redaction': { name: '敏感信息脱敏', description: '识别并遮蔽案件材料中的个人与敏感信息。' },
  'legal-article-verify': { name: '法条核验', description: '核验法律条文的存在性、现行效力和引用准确性。' },
  'legal-assistant': { name: '法律助理', description: '辅助完成法律检索、风险识别、分析与任务总结。' },
  'legal-analysis-quality': { name: '权益份额精算', description: '按时间线和权益来源复核继承、共有与份额计算。' },
  'obsidian-bases': { name: '结构化知识库', description: '维护案件知识库中的结构化视图和数据集合。' },
  'obsidian-markdown': { name: '知识库文档', description: '生成符合知识库规范的 Markdown 案件文档。' },
  'opponent-prediction': { name: '对方策略预判', description: '从对方立场识别可能的抗辩、证据与程序策略。' },
  'pkulaw-search': { name: '北大法宝检索', description: '通过已配置的法律数据库检索法条、案例与实务资料。' },
  'rag-knowledge-base': { name: '案件知识库', description: '建立可检索的案件资料库，为分析提供材料依据。' },
  'receiving-code-review': { name: '接收代码审查', description: '核对审查意见的依据，并有序落实有效修改。' },
  'requesting-code-review': { name: '发起代码审查', description: '在交付前组织代码审查并整理待核验事项。' },
  'self-improving-agent': { name: '经验归纳', description: '从已完成任务中整理可复用的工作经验与模式。' },
  'status-polling': { name: '任务状态轮询', description: '持续同步案件处理、分析、审查和交付进度。' },
  'subagent-driven-development': { name: '子任务驱动开发', description: '将独立实施工作交给子任务并汇总验证结果。' },
  'systematic-debugging': { name: '系统化故障排查', description: '先收集证据和定位根因，再提出可验证的修复方案。' },
  'test-driven-development': { name: '测试驱动开发', description: '先定义可验证行为，再实施功能或修复缺陷。' },
  'trial-outline': { name: '庭审提纲', description: '围绕事实、证据、争点和庭审顺序生成庭审提纲。' },
  'using-git-worktrees': { name: 'Git 工作树', description: '使用独立工作树隔离开发任务，避免相互干扰。' },
  'using-superpowers': { name: '技能使用规范', description: '在任务开始前识别并按要求使用匹配的技能。' },
  'verification-before-completion': { name: '完成前验证', description: '在宣布完成前运行检查并确认结果真实可复现。' },
  'writing-plans': { name: '实施计划', description: '把需求整理为可执行、可验证的分步计划。' },
  'writing-skills': { name: '技能编写', description: '创建、维护和验证可复用的本地技能。' },
}

export function displaySkill(skill: LawClawSkill): { name: string, description: string } {
  return localizedSkills[skill.id] ?? { name: skill.name, description: skill.description }
}
