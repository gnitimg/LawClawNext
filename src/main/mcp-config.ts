import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface McpServerConfig {
  id: string
  name: string
  serverName: string
  enabled: boolean
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
}

export interface McpTestResult {
  serverName: string
  toolCount: number
  tools: string[]
  message: string
}

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u

function encryptedPath(): string {
  return resolve(app.getPath('userData'), 'mcp-servers.enc')
}

function boundedTimeout(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1_000, Math.min(300_000, Math.round(number))) : 60_000
}

function stringMap(value: unknown, keyPattern: RegExp): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => keyPattern.test(key) && typeof item === 'string')
    .map(([key, item]) => [key, String(item)]))
}

function safeUrl(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (candidate === '') return ''
  const url = new URL(candidate)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('远程 MCP 地址必须使用 HTTPS；只有本机 localhost 可以使用 HTTP。')
  }
  return url.toString()
}

export function normalizeMcpServer(value: unknown): McpServerConfig {
  const source = typeof value === 'object' && value !== null ? value as Partial<McpServerConfig> : {}
  const serverName = typeof source.serverName === 'string' ? source.serverName.trim() : ''
  if (!SERVER_NAME.test(serverName)) throw new Error('MCP 标识只能包含字母、数字、下划线或短横线，长度 1–32。')
  const transport = source.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const command = typeof source.command === 'string' ? source.command.trim() : ''
  const url = transport === 'streamable-http' ? safeUrl(source.url) : ''
  if (transport === 'stdio' && command === '') throw new Error(`MCP “${serverName}”缺少启动命令。`)
  if (transport === 'streamable-http' && url === '') throw new Error(`MCP “${serverName}”缺少服务地址。`)
  return {
    id: typeof source.id === 'string' && source.id.trim() !== '' ? source.id.trim() : randomUUID(),
    name: typeof source.name === 'string' && source.name.trim() !== '' ? source.name.trim() : serverName,
    serverName,
    enabled: source.enabled !== false,
    transport,
    command,
    args: Array.isArray(source.args) ? source.args.filter((item): item is string => typeof item === 'string') : [],
    cwd: typeof source.cwd === 'string' ? source.cwd.trim() : '',
    env: stringMap(source.env, ENV_NAME),
    url,
    headers: stringMap(source.headers, HEADER_NAME),
    toolCallTimeoutMs: boundedTimeout(source.toolCallTimeoutMs),
  }
}

export function normalizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  const servers = value.map(normalizeMcpServer)
  const names = new Set<string>()
  for (const server of servers) {
    if (names.has(server.serverName)) throw new Error(`MCP 标识重复：${server.serverName}`)
    names.add(server.serverName)
  }
  return servers
}

export function readMcpServers(): McpServerConfig[] {
  const path = encryptedPath()
  if (!existsSync(path)) return []
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，无法读取 MCP 凭据。')
  const plaintext = safeStorage.decryptString(Buffer.from(readFileSync(path, 'utf8'), 'base64'))
  return normalizeMcpServers(JSON.parse(plaintext) as unknown)
}

export function writeMcpServers(value: unknown): McpServerConfig[] {
  const servers = normalizeMcpServers(value)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，MCP 凭据未保存。')
  const ciphertext = safeStorage.encryptString(JSON.stringify(servers))
  writeFileSync(encryptedPath(), ciphertext.toString('base64'), { encoding: 'utf8', mode: 0o600 })
  return servers
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

export function writeMcpRuntimePatch(dshHome: string, servers = readMcpServers()): { patchPath?: string, env: Record<string, string> } {
  const enabled = servers.filter((server) => server.enabled)
  const patchPath = resolve(dshHome, 'mcp.patch.yml')
  const workflowScript = app.isPackaged
    ? resolve(process.resourcesPath, 'lawclaw/mcp/workflow-server.mjs')
    : resolve(app.getAppPath(), 'resources/lawclaw/mcp/workflow-server.mjs')
  const env: Record<string, string> = {}
  const lines: string[] = [
    '# Generated by LawClaw Next. Secrets are injected through the child environment.',
    '- id: lawclaw-workflow-progress',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: "lawclaw_workflow"',
    '    transport: "stdio"',
    `    command: ${yamlString(process.execPath)}`,
    `    args: ${JSON.stringify([workflowScript])}`,
    '    env:',
    '      "ELECTRON_RUN_AS_NODE": "1"',
    '    toolCallTimeoutMs: 10000',
    '    failOnStartupError: true',
  ]
  enabled.forEach((server, serverIndex) => {
    lines.push(`- id: lawclaw-mcp-${server.id.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 48)}`)
    lines.push(`  name: '@deepseek-ai/dsh-mcp-client'`)
    lines.push('  config:')
    lines.push(`    serverName: ${yamlString(server.serverName)}`)
    lines.push(`    transport: ${yamlString(server.transport)}`)
    lines.push(`    toolCallTimeoutMs: ${String(server.toolCallTimeoutMs)}`)
    lines.push('    failOnStartupError: false')
    if (server.transport === 'stdio') {
      lines.push(`    command: ${yamlString(server.command)}`)
      if (server.args.length > 0) lines.push(`    args: ${JSON.stringify(server.args)}`)
      if (server.cwd !== '') lines.push(`    cwd: ${yamlString(server.cwd)}`)
      const entries = Object.entries(server.env)
      if (entries.length > 0) {
        lines.push('    env:')
        entries.forEach(([key, secret], index) => {
          const envName = `LAWCLAW_MCP_${String(serverIndex)}_ENV_${String(index)}`
          env[envName] = secret
          lines.push(`      ${yamlString(key)}: !!js process.env.${envName}`)
        })
      }
    } else {
      lines.push(`    url: ${yamlString(server.url)}`)
      const entries = Object.entries(server.headers)
      if (entries.length > 0) {
        lines.push('    headers:')
        entries.forEach(([key, secret], index) => {
          const envName = `LAWCLAW_MCP_${String(serverIndex)}_HEADER_${String(index)}`
          env[envName] = secret
          lines.push(`      ${yamlString(key)}: !!js process.env.${envName}`)
        })
      }
    }
  })
  writeFileSync(patchPath, `${lines.join('\n')}\n`, 'utf8')
  return { patchPath, env }
}

export async function testMcpServer(value: unknown): Promise<McpTestResult> {
  const server = normalizeMcpServer(value)
  const client = new Client({ name: 'lawclaw-next-mcp-check', version: app.getVersion() })
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...server.env },
      ...(server.cwd === '' ? {} : { cwd: server.cwd }),
      stderr: 'pipe',
    })
    : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
  try {
    await client.connect(transport, { timeout: 15_000, maxTotalTimeout: 15_000 })
    const result = await client.listTools(undefined, { timeout: 15_000, maxTotalTimeout: 15_000 })
    const tools = result.tools.map((tool) => tool.name)
    return {
      serverName: server.serverName,
      toolCount: tools.length,
      tools: tools.slice(0, 20),
      message: tools.length === 0 ? '连接成功，但服务器当前没有发布工具。' : `连接成功，发现 ${String(tools.length)} 个工具。`,
    }
  } finally {
    await client.close().catch(() => {})
  }
}
