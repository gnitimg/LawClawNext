/**
 * dsh API proxy in the Electron main process. The renderer is a file:// origin
 * and cannot call the dsh web host directly (CORS + Origin fence + HttpOnly
 * cookie). This module performs the token→cookie exchange once, then proxies
 * unary RPCs (POST /api/<method>) and WebSocket streams (/api/remote.mux) on
 * behalf of the renderer, forwarding stream frames over IPC.
 */
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

interface RpcResultOk<T> { ok: true, value: T }
interface RpcResultErr { ok: false, error: { code: string, message: string, details?: unknown } }
type RpcResult<T> = RpcResultOk<T> | RpcResultErr

interface ClientRequest {
  type: 'client-request'
  rpcId: string
  method: string
  payload: { args: unknown }
}

interface ServerResponse<T> {
  type: 'server-response'
  rpcId: string
  result: RpcResult<T>
}

export interface DshApiProxy {
  rpc: <T>(method: string, args: unknown) => Promise<RpcResult<T>>
  openStream: (endpoint: string, args: unknown) => string
  cancelStream: (streamId: string) => void
  dispose: () => void
}

export type StreamFrameType = 'item' | 'error' | 'end'
export interface StreamFrameEvent { streamId: string, type: StreamFrameType, value?: unknown, error?: { code: string, message: string } }

const STREAM_MUX_PATH = '/api/remote.mux'

/** Exchange the launch token for a signed session cookie by fetching the
 * token URL (which 303-redirects and sets the cookie). Returns the cookie
 * header value for subsequent requests. */
async function exchangeTokenForCookie(tokenUrl: string): Promise<string> {
  const response = await fetch(tokenUrl, { method: 'GET', redirect: 'manual' })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error(`token exchange: no Set-Cookie (status ${String(response.status)})`)
  const first = setCookie.split(',')[0]!.split(';')[0]!
  const eq = first.indexOf('=')
  if (eq < 0) throw new Error(`token exchange: malformed Set-Cookie "${first}"`)
  return first
}

function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + STREAM_MUX_PATH
}

export async function createDshApiProxy(hostUrl: string, onFrame: (frame: StreamFrameEvent) => void): Promise<DshApiProxy> {
  const baseUrl = hostUrl.split('?')[0]!.replace(/\/+$/u, '')
  const cookie = await exchangeTokenForCookie(hostUrl)
  const headers = { cookie, 'content-type': 'application/json' }

  let ws: WebSocket | undefined
  // Stream state only needs membership tracking. Using EventEmitter here made
  // DSH's ordinary `error` stream frame a fatal, unhandled Node `error` event.
  const streams = new Set<string>()
  const pendingOpens = new Map<string, { resolve: () => void, reject: (e: Error) => void }>()

  function ensureWs(): WebSocket {
    if (ws !== undefined && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws
    const socket = new WebSocket(wsUrl(baseUrl), { headers: { cookie } })
    socket.on('message', (raw: Buffer) => {
      let frame: { type: string, streamId?: string, value?: unknown, error?: { code: string, message: string } }
      try { frame = JSON.parse(raw.toString()) } catch { return }
      const sid = frame.streamId
      if (sid === undefined) return
      if (!streams.has(sid)) return
      if (frame.type === 'item') onFrame({ streamId: sid, type: 'item', value: frame.value })
      else if (frame.type === 'error') { onFrame({ streamId: sid, type: 'error', error: frame.error }); streams.delete(sid) }
      else if (frame.type === 'end') { onFrame({ streamId: sid, type: 'end' }); streams.delete(sid) }
      else if (frame.type === 'open') { const p = pendingOpens.get(sid); if (p !== undefined) { pendingOpens.delete(sid); p.resolve() } }
    })
    socket.on('error', (err: Error) => { for (const [, p] of pendingOpens) p.reject(new Error(`ws error: ${err.message}`)); pendingOpens.clear() })
    socket.on('close', () => { for (const streamId of streams) onFrame({ streamId, type: 'end' }); streams.clear() })
    ws = socket
    return socket
  }

  async function rpc<T>(method: string, args: unknown): Promise<RpcResult<T>> {
    const body: ClientRequest = { type: 'client-request', rpcId: randomUUID(), method, payload: { args } }
    const response = await fetch(`${baseUrl}/api/${method}`, { method: 'POST', headers, body: JSON.stringify(body) })
    const json = (await response.json()) as ServerResponse<T>
    return json.result
  }

  function openStream(endpoint: string, args: unknown): string {
    const streamId = randomUUID()
    streams.add(streamId)
    const socket = ensureWs()
    const send = (): void => {
      const openFrame = { type: 'open', streamId, endpoint, payload: { args } }
      socket.send(JSON.stringify(openFrame))
    }
    if (socket.readyState === WebSocket.OPEN) send()
    else socket.once('open', send)
    return streamId
  }

  function cancelStream(streamId: string): void {
    const socket = ws
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'cancel', streamId }))
    }
    streams.delete(streamId)
  }

  function dispose(): void {
    ws?.close()
    ws = undefined
    streams.clear()
    pendingOpens.clear()
  }

  return { rpc, openStream, cancelStream, dispose }
}
