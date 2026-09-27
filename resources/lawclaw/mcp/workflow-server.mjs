import process from 'node:process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const stages = new Set(['preprocessing', 'analysis', 'drafting', 'review', 'arbitration', 'delivery'])
const statuses = new Set(['started', 'completed', 'failed'])
const formalMarkdownFiles = ['案件分析报告.md', '辩护意见书.md', '对方策略预判.md', '质证意见.md']
let buffer = ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function textNodeContent(canvas) {
  return canvas.nodes
    .filter((node) => node && typeof node === 'object' && typeof node.text === 'string')
    .map((node) => node.text)
    .join('\n')
}

function validateDelivery(args) {
  const failures = []
  const directory = resolve(args.directory)
  const read = (name) => {
    const path = resolve(directory, name)
    if (!path.startsWith(`${directory}\\`) && !path.startsWith(`${directory}/`)) {
      failures.push(`${name}: 路径越界`)
      return ''
    }
    if (!existsSync(path) || !statSync(path).isFile()) {
      failures.push(`${name}: 文件不存在`)
      return ''
    }
    try {
      const content = readFileSync(path, 'utf8')
      if (content.trim() === '') failures.push(`${name}: 文件为空`)
      return content
    } catch (reason) {
      failures.push(`${name}: 无法读取（${String(reason)}）`)
      return ''
    }
  }
  const draftLine = `起草：${args.draftSignature}`
  const opponentStamp = new RegExp(`评审【opponents】：(?:通过|不通过)\\s+${escapeRegExp(args.reviewerOpponentsSignature)}`, 'u')
  const judgeStamp = new RegExp(`评审【judge】：(?:通过|不通过)\\s+${escapeRegExp(args.reviewerJudgeSignature)}`, 'u')
  const mainConclusion = new RegExp(`结论：(?:通过|不通过|退回人工复核)\\s+${escapeRegExp(args.mainSignature)}`, 'u')
  for (const name of formalMarkdownFiles) {
    const content = read(name)
    if (content === '') continue
    if (!content.includes(draftLine)) failures.push(`${name}: 缺少准确的起草署名`)
    if (!opponentStamp.test(content)) failures.push(`${name}: 缺少对方律师核验戳`)
    if (!judgeStamp.test(content)) failures.push(`${name}: 缺少法官核验戳`)
    if (!mainConclusion.test(content)) failures.push(`${name}: 缺少 Main 最终结论`)
  }
  const canvasText = read('知识图谱.canvas')
  if (canvasText !== '') {
    try {
      const canvas = JSON.parse(canvasText)
      if (canvas === null || typeof canvas !== 'object' || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
        failures.push('知识图谱.canvas: 根对象必须包含 nodes 和 edges 数组')
      } else if (!textNodeContent(canvas).includes(draftLine)) {
        failures.push('知识图谱.canvas: 缺少包含准确起草署名的文本节点')
      }
    } catch (reason) {
      failures.push(`知识图谱.canvas: JSON 无效（${String(reason)}）`)
    }
  }
  const report = read('report.md')
  if (report !== '') {
    if (!report.includes(args.reviewerOpponentsSignature)) failures.push('report.md: 缺少对方律师审查署名')
    if (!report.includes(args.reviewerJudgeSignature)) failures.push('report.md: 缺少法官审查署名')
    if (!report.includes(`署名：${args.mainSignature}`)) failures.push('report.md: 缺少 Main 署名')
  }
  return { valid: failures.length === 0, directory, failures }
}

function handle(message) {
  if (message === null || typeof message !== 'object' || typeof message.method !== 'string') return
  if (message.method === 'notifications/initialized') return
  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'lawclaw-workflow', version: '1.0.0' },
    })
    return
  }
  if (message.method === 'ping') {
    result(message.id, {})
    return
  }
  if (message.method === 'tools/list') {
    result(message.id, {
      tools: [{
        name: 'report_progress',
        title: '更新案件流程进度',
        description: '在案件处理阶段开始、完成或失败时更新 LawClaw 案件进度。只报告真实发生的状态。',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['stage', 'status'],
          properties: {
            stage: { type: 'string', enum: [...stages] },
            status: { type: 'string', enum: [...statuses] },
            detail: { type: 'string', maxLength: 500 },
          },
        },
      }, {
        name: 'validate_delivery',
        title: '核验正式交付文件',
        description: '正式交付前核验五类产物、Canvas JSON、起草/审查/Main 署名和统一审查报告。',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['directory', 'draftSignature', 'reviewerOpponentsSignature', 'reviewerJudgeSignature', 'mainSignature'],
          properties: {
            directory: { type: 'string', minLength: 1 },
            draftSignature: { type: 'string', minLength: 1 },
            reviewerOpponentsSignature: { type: 'string', minLength: 1 },
            reviewerJudgeSignature: { type: 'string', minLength: 1 },
            mainSignature: { type: 'string', minLength: 1 },
          },
        },
      }],
    })
    return
  }
  if (message.method === 'tools/call') {
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
    if (params.name === 'validate_delivery') {
      if (typeof args.directory !== 'string' || typeof args.draftSignature !== 'string' ||
          typeof args.reviewerOpponentsSignature !== 'string' || typeof args.reviewerJudgeSignature !== 'string' ||
          typeof args.mainSignature !== 'string') {
        error(message.id, -32602, 'Invalid delivery validation request')
        return
      }
      const validation = validateDelivery(args)
      result(message.id, {
        content: [{
          type: 'text',
          text: validation.valid
            ? '正式交付核验通过。'
            : `正式交付核验未通过：\n- ${validation.failures.join('\n- ')}`,
        }],
        structuredContent: validation,
        ...(validation.valid ? {} : { isError: true }),
      })
      return
    }
    if (params.name !== 'report_progress' || !stages.has(args.stage) || !statuses.has(args.status)) {
      error(message.id, -32602, 'Invalid workflow progress report')
      return
    }
    result(message.id, {
      content: [{ type: 'text', text: `案件进度已更新：${args.stage} / ${args.status}` }],
      structuredContent: { accepted: true, stage: args.stage, status: args.status },
    })
    return
  }
  if (message.id !== undefined) error(message.id, -32601, `Method not found: ${message.method}`)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).replace(/\r$/u, '')
    buffer = buffer.slice(newline + 1)
    if (line.trim() === '') continue
    try {
      handle(JSON.parse(line))
    } catch (reason) {
      process.stderr.write(`LawClaw workflow MCP rejected malformed input: ${String(reason)}\n`)
    }
  }
})
