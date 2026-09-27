import assert from 'node:assert/strict'
import test from 'node:test'
import {
  foldWorkflowProgress,
  initialWorkflowProgress,
  workflowProgressFromRecords,
  workflowReportFromEvent,
} from '../src/renderer/src/workflow-progress'

test('reads persisted workflow tool calls in supported DSH shapes', () => {
  assert.deepEqual(workflowReportFromEvent({
    type: 'tool/call',
    seq: 3,
    time: 0,
    data: {
      name: 'mcp__lawclaw_workflow__report_progress',
      arguments: '{"stage":"preprocessing","status":"completed"}',
    },
  }), { stage: 'preprocessing', status: 'completed' })

  assert.deepEqual(workflowReportFromEvent({
    type: 'tool/call',
    seq: 4,
    time: 0,
    data: {
      tool: { name: 'mcp__lawclaw_workflow__report_progress', input: { stage: 'analysis', status: 'started' } },
    },
  }), { stage: 'analysis', status: 'started' })
})

test('advances only on explicit completion and keeps failures at the failed stage', () => {
  const started = foldWorkflowProgress(initialWorkflowProgress(), {
    type: 'tool/call', seq: 1, time: 0,
    data: { name: 'mcp__lawclaw_workflow__report_progress', arguments: { stage: 'preprocessing', status: 'started' } },
  })
  assert.deepEqual(started.completedStages, [])
  assert.equal(started.activeStage, 'preprocessing')
  assert.equal(started.reported, true)

  const completed = foldWorkflowProgress(started, {
    type: 'tool/call', seq: 2, time: 0,
    data: { name: 'mcp__lawclaw_workflow__report_progress', arguments: { stage: 'preprocessing', status: 'completed' } },
  })
  assert.deepEqual(completed.completedStages, ['preprocessing'])
  assert.equal(completed.activeStage, 'analysis')

  const failed = foldWorkflowProgress(completed, {
    type: 'tool/call', seq: 3, time: 0,
    data: { name: 'mcp__lawclaw_workflow__report_progress', arguments: { stage: 'analysis', status: 'failed', detail: '模型请求失败' } },
  })
  assert.equal(failed.activeStage, 'analysis')
  assert.equal(failed.failedStage, 'analysis')
  assert.deepEqual(failed.completedStages, ['preprocessing'])
})

test('restores progress from history and resets when a new user turn starts', () => {
  const progress = workflowProgressFromRecords([
    { event: { type: 'user/message', seq: 1, time: 0, data: { source: { kind: 'user' } } } },
    { event: { type: 'tool/call', seq: 2, time: 0, data: { name: 'mcp__lawclaw_workflow__report_progress', arguments: { stage: 'preprocessing', status: 'completed' } } } },
    { event: { type: 'user/message', seq: 3, time: 0, data: { source: { kind: 'user' } } } },
  ])
  assert.deepEqual(progress, initialWorkflowProgress())
})

test('does not claim preprocessing before the workflow reports a stage', () => {
  const progress = workflowProgressFromRecords([
    { event: { type: 'user/message', seq: 1, time: 0, data: { source: { kind: 'user' } } } },
    { event: { type: 'assistant/message', seq: 2, time: 0, data: { text: 'stopped without a workflow report' } } },
  ])
  assert.equal(progress.reported, false)
  assert.deepEqual(progress.completedStages, [])
})
