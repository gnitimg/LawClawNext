import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('built-in workflow MCP publishes and accepts progress reports', async () => {
  const client = new Client({ name: 'lawclaw-workflow-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('resources/lawclaw/mcp/workflow-server.mjs')],
    stderr: 'pipe',
  })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map((tool) => tool.name), ['report_progress', 'validate_delivery'])
    const response = await client.callTool({
      name: 'report_progress',
      arguments: { stage: 'preprocessing', status: 'started' },
    })
    assert.equal(response.isError, undefined)
    assert.deepEqual(response.structuredContent, {
      accepted: true,
      stage: 'preprocessing',
      status: 'started',
    })
  } finally {
    await client.close().catch(() => {})
  }
})

test('built-in workflow MCP validates canvas and provenance signatures before delivery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lawclaw-delivery-'))
  const client = new Client({ name: 'lawclaw-delivery-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('resources/lawclaw/mcp/workflow-server.mjs')],
    stderr: 'pipe',
  })
  const signatures = {
    draftSignature: 'Lawyer Agent（provider / draft-model）',
    reviewerOpponentsSignature: 'Reviewer Opponents（provider / opponent-model）',
    reviewerJudgeSignature: 'Reviewer Judge（provider / judge-model）',
    mainSignature: 'Main Agent（provider / main-model）',
  }
  const document = [
    '# 正式文书',
    '',
    '正文。',
    '',
    '---',
    `起草：${signatures.draftSignature}`,
    `评审【opponents】：通过 ${signatures.reviewerOpponentsSignature}`,
    `评审【judge】：通过 ${signatures.reviewerJudgeSignature}`,
    `结论：通过 ${signatures.mainSignature}`,
  ].join('\n')
  try {
    for (const name of ['案件分析报告.md', '辩护意见书.md', '对方策略预判.md', '质证意见.md']) {
      writeFileSync(join(root, name), document, 'utf8')
    }
    writeFileSync(join(root, '知识图谱.canvas'), JSON.stringify({
      nodes: [{ id: 'signature', type: 'text', text: `模型署名\n起草：${signatures.draftSignature}` }],
      edges: [],
    }), 'utf8')
    writeFileSync(join(root, 'report.md'), [
      '# 交叉核验报告',
      signatures.reviewerOpponentsSignature,
      signatures.reviewerJudgeSignature,
      `署名：${signatures.mainSignature}`,
    ].join('\n'), 'utf8')
    await client.connect(transport)
    const response = await client.callTool({
      name: 'validate_delivery',
      arguments: { directory: root, ...signatures },
    })
    assert.equal(response.isError, undefined)
    assert.deepEqual(response.structuredContent, { valid: true, directory: resolve(root), failures: [] })
  } finally {
    await client.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
