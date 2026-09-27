import assert from 'node:assert/strict'
import test from 'node:test'
import {
  arbitrateReviews,
  authorizeRepair,
  createWorkflow,
  finishReview,
  recordRepairApplied,
  reviewsTerminal,
  sealDraft,
  startReview,
  verifyRepair,
} from '../src/main/lawclaw-workflow'

const digest = 'a'.repeat(64)

test('independent reviewers receive the same frozen draft and arbitration waits for both', () => {
  let state = sealDraft(createWorkflow('case-1'), digest)
  state = startReview(state, 'reviewer-opponents')
  state = startReview(state, 'reviewer-judge')
  assert.equal(state.reviews['reviewer-opponents'].draftDigest, digest)
  assert.equal(state.reviews['reviewer-judge'].draftDigest, digest)
  state = finishReview(state, 'reviewer-opponents', { reportPath: 'review/opponents.md' })
  assert.equal(reviewsTerminal(state), false)
  assert.throws(() => arbitrateReviews(state, 'passed', 'review/arbitration.md'), /Both independent reviewers/)
  state = finishReview(state, 'reviewer-judge', { reportPath: 'review/judge.md' })
  state = arbitrateReviews(state, 'passed', 'review/arbitration.md')
  assert.equal(state.stage, 'delivery')
})

test('one failed reviewer can only complete with issues after Main writes arbitration', () => {
  let state = sealDraft(createWorkflow('case-2'), digest)
  state = startReview(state, 'reviewer-opponents')
  state = startReview(state, 'reviewer-judge')
  state = finishReview(state, 'reviewer-opponents', { reportPath: 'review/opponents.md' })
  state = finishReview(state, 'reviewer-judge', { error: 'provider timeout' })
  assert.throws(() => arbitrateReviews(state, 'passed', 'review/arbitration.md'), /failed reviewer/)
  assert.throws(() => arbitrateReviews(state, 'completed_with_issues', ''), /report is required/)
  state = arbitrateReviews(state, 'completed_with_issues', 'review/arbitration.md')
  assert.equal(state.arbitration?.outcome, 'completed_with_issues')
})

test('repair agent cannot mutate without explicit approval, path allowlist, checkpoint, and verification', () => {
  const failed = { ...createWorkflow('case-3'), stage: 'failed' as const }
  assert.throws(() => authorizeRepair(failed, { approvedByUser: false, failureId: 'ocr-1', checkpointId: 'cp-1', allowedPaths: ['output/text.txt'] }), /explicit user approval/)
  assert.throws(() => authorizeRepair(failed, { approvedByUser: true, failureId: 'ocr-1', checkpointId: 'cp-1', allowedPaths: ['../outside'] }), /Unsafe repair path/)
  let state = authorizeRepair(failed, { approvedByUser: true, failureId: 'ocr-1', checkpointId: 'cp-1', allowedPaths: ['output/text.txt'] })
  state = recordRepairApplied(state)
  assert.throws(() => verifyRepair(state, true, ''), /verification evidence/)
  state = verifyRepair(state, false, 'OCR quality regression still fails; checkpoint restored')
  assert.equal(state.stage, 'failed')
  assert.equal(state.repair?.status, 'rolled_back')
})
