export const REVIEWER_IDS = ['reviewer-opponents', 'reviewer-judge'] as const
export type ReviewerId = typeof REVIEWER_IDS[number]
export type ReviewStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ReviewBranch {
  reviewerId: ReviewerId
  status: ReviewStatus
  draftDigest?: string
  reportPath?: string
  error?: string
}

export interface RepairAttempt {
  failureId: string
  approvedByUser: true
  checkpointId: string
  allowedPaths: string[]
  status: 'authorized' | 'applied' | 'verified' | 'rolled_back'
  verification?: string
}

export interface LawClawWorkflowState {
  caseId: string
  stage: 'intake' | 'analysis' | 'review' | 'arbitration' | 'delivery' | 'failed' | 'repair'
  draftDigest?: string
  reviews: Record<ReviewerId, ReviewBranch>
  arbitration?: { outcome: 'passed' | 'completed_with_issues' | 'manual_review'; reportPath: string }
  repair?: RepairAttempt
}

export function createWorkflow(caseId: string): LawClawWorkflowState {
  if (caseId.trim() === '') throw new Error('caseId is required')
  return {
    caseId,
    stage: 'intake',
    reviews: {
      'reviewer-opponents': { reviewerId: 'reviewer-opponents', status: 'pending' },
      'reviewer-judge': { reviewerId: 'reviewer-judge', status: 'pending' },
    },
  }
}

export function sealDraft(state: LawClawWorkflowState, draftDigest: string): LawClawWorkflowState {
  if (!/^[a-f0-9]{64}$/iu.test(draftDigest)) throw new Error('draftDigest must be a SHA-256 digest')
  return { ...state, stage: 'review', draftDigest }
}

export function startReview(state: LawClawWorkflowState, reviewerId: ReviewerId): LawClawWorkflowState {
  if (state.stage !== 'review' || state.draftDigest === undefined) throw new Error('A sealed draft is required before review')
  if (state.reviews[reviewerId].status !== 'pending') throw new Error(`${reviewerId} has already started`)
  return {
    ...state,
    reviews: {
      ...state.reviews,
      [reviewerId]: { reviewerId, status: 'running', draftDigest: state.draftDigest },
    },
  }
}

export function finishReview(
  state: LawClawWorkflowState,
  reviewerId: ReviewerId,
  result: { reportPath?: string, error?: string },
): LawClawWorkflowState {
  const branch = state.reviews[reviewerId]
  if (branch.status !== 'running') throw new Error(`${reviewerId} is not running`)
  const completed = typeof result.reportPath === 'string' && result.reportPath.trim() !== ''
  return {
    ...state,
    reviews: {
      ...state.reviews,
      [reviewerId]: {
        ...branch,
        status: completed ? 'completed' : 'failed',
        ...(completed ? { reportPath: result.reportPath } : { error: result.error?.trim() || 'review failed' }),
      },
    },
  }
}

export function reviewsTerminal(state: LawClawWorkflowState): boolean {
  return REVIEWER_IDS.every((reviewerId) => ['completed', 'failed'].includes(state.reviews[reviewerId].status))
}

export function arbitrateReviews(
  state: LawClawWorkflowState,
  outcome: 'passed' | 'completed_with_issues' | 'manual_review',
  reportPath: string,
): LawClawWorkflowState {
  if (!reviewsTerminal(state)) throw new Error('Both independent reviewers must finish before Main arbitration')
  if (reportPath.trim() === '') throw new Error('Main arbitration report is required')
  const completed = REVIEWER_IDS.filter((reviewerId) => state.reviews[reviewerId].status === 'completed').length
  if (completed === 0) throw new Error('Main cannot arbitrate when both reviewers failed')
  if (outcome === 'passed' && completed !== REVIEWER_IDS.length) throw new Error('A failed reviewer cannot produce a passed outcome')
  return { ...state, stage: outcome === 'manual_review' ? 'failed' : 'delivery', arbitration: { outcome, reportPath } }
}

function assertRepairPath(path: string): void {
  const normalized = path.replace(/\\/gu, '/').trim()
  if (normalized === '' || normalized === '/' || /^[a-z]:\/?$/iu.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe repair path: ${path}`)
  }
}

export function authorizeRepair(state: LawClawWorkflowState, request: {
  approvedByUser: boolean
  failureId: string
  checkpointId: string
  allowedPaths: string[]
}): LawClawWorkflowState {
  if (!request.approvedByUser) throw new Error('Repair requires explicit user approval')
  if (request.failureId.trim() === '' || request.checkpointId.trim() === '') throw new Error('Repair requires a failure and rollback checkpoint')
  if (request.allowedPaths.length === 0) throw new Error('Repair requires an explicit path allowlist')
  request.allowedPaths.forEach(assertRepairPath)
  return {
    ...state,
    stage: 'repair',
    repair: {
      failureId: request.failureId,
      approvedByUser: true,
      checkpointId: request.checkpointId,
      allowedPaths: [...new Set(request.allowedPaths)],
      status: 'authorized',
    },
  }
}

export function recordRepairApplied(state: LawClawWorkflowState): LawClawWorkflowState {
  if (state.repair?.status !== 'authorized') throw new Error('Repair is not authorized')
  return { ...state, repair: { ...state.repair, status: 'applied' } }
}

export function verifyRepair(state: LawClawWorkflowState, passed: boolean, verification: string): LawClawWorkflowState {
  if (state.repair?.status !== 'applied') throw new Error('Repair has not been applied')
  if (verification.trim() === '') throw new Error('Repair verification evidence is required')
  return passed
    ? { ...state, stage: 'analysis', repair: { ...state.repair, status: 'verified', verification } }
    : { ...state, stage: 'failed', repair: { ...state.repair, status: 'rolled_back', verification } }
}
