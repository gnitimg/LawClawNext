import type { SessionEvent } from './types'

export const lawClawWorkflowStages = [
  { id: 'preprocessing', label: '材料预处理' },
  { id: 'analysis', label: '案件分析' },
  { id: 'drafting', label: '文书起草' },
  { id: 'review', label: '双重审查' },
  { id: 'arbitration', label: 'Main 仲裁' },
  { id: 'delivery', label: '正式交付' },
] as const

export type LawClawWorkflowStage = typeof lawClawWorkflowStages[number]['id']
export type LawClawWorkflowStatus = 'started' | 'completed' | 'failed'

export interface LawClawWorkflowReport {
  stage: LawClawWorkflowStage
  status: LawClawWorkflowStatus
  detail?: string
}

export interface LawClawWorkflowProgress {
  activeStage: LawClawWorkflowStage
  completedStages: readonly LawClawWorkflowStage[]
  /** True only after the workflow MCP has reported an actual stage. */
  reported: boolean
  failedStage?: LawClawWorkflowStage
  failureDetail?: string
}

const workflowToolPattern = /(?:^|__)lawclaw_workflow__(?:report_progress|report_case_progress)$|^(?:report_progress|report_case_progress)$/u

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parsedObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return objectOf(JSON.parse(value) as unknown)
    } catch {
      return undefined
    }
  }
  return objectOf(value)
}

function isStage(value: unknown): value is LawClawWorkflowStage {
  return lawClawWorkflowStages.some((stage) => stage.id === value)
}

function isStatus(value: unknown): value is LawClawWorkflowStatus {
  return value === 'started' || value === 'completed' || value === 'failed'
}

export function workflowReportFromEvent(event: SessionEvent): LawClawWorkflowReport | undefined {
  if (event.type !== 'tool/call') return undefined
  const data = objectOf(event.data)
  const tool = objectOf(data?.tool)
  const name = data?.name ?? data?.toolName ?? tool?.name
  if (typeof name !== 'string' || !workflowToolPattern.test(name)) return undefined

  const candidates = [data?.arguments, data?.args, data?.input, tool?.arguments, tool?.args, tool?.input]
  const input = candidates.map(parsedObject).find((candidate) => candidate !== undefined)
  if (input === undefined || !isStage(input.stage) || !isStatus(input.status)) return undefined
  return {
    stage: input.stage,
    status: input.status,
    ...(typeof input.detail === 'string' && input.detail.trim() !== '' ? { detail: input.detail.trim() } : {}),
  }
}

export function initialWorkflowProgress(): LawClawWorkflowProgress {
  return { activeStage: 'preprocessing', completedStages: [], reported: false }
}

export function foldWorkflowProgress(
  current: LawClawWorkflowProgress,
  event: SessionEvent,
): LawClawWorkflowProgress {
  if (event.type === 'user/message' && objectOf(objectOf(event.data)?.source)?.kind === 'user') {
    return initialWorkflowProgress()
  }
  const report = workflowReportFromEvent(event)
  if (report === undefined) return current
  if (report.status === 'failed') {
    return {
      ...current,
      activeStage: report.stage,
      reported: true,
      failedStage: report.stage,
      ...(report.detail === undefined ? {} : { failureDetail: report.detail }),
    }
  }

  const completed = new Set(current.completedStages)
  if (report.status === 'completed') completed.add(report.stage)
  const stageIndex = lawClawWorkflowStages.findIndex((stage) => stage.id === report.stage)
  const nextStage = lawClawWorkflowStages[Math.min(stageIndex + 1, lawClawWorkflowStages.length - 1)]?.id ?? report.stage
  return {
    activeStage: report.status === 'completed' ? nextStage : report.stage,
    completedStages: [...completed],
    reported: true,
  }
}

export function workflowProgressFromRecords(records: readonly unknown[]): LawClawWorkflowProgress {
  return records.reduce<LawClawWorkflowProgress>((progress, record) => {
    const object = objectOf(record)
    const candidate = objectOf(object?.event) ?? object
    if (candidate === undefined || typeof candidate.type !== 'string' || typeof candidate.seq !== 'number') return progress
    return foldWorkflowProgress(progress, {
      type: candidate.type,
      seq: candidate.seq,
      time: typeof candidate.time === 'string' || typeof candidate.time === 'number' ? candidate.time : 0,
      data: candidate.data,
    })
  }, initialWorkflowProgress())
}
