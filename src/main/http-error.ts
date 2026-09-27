const STATUS_HINTS: Readonly<Record<number, string>> = {
  400: '请求参数未被服务商接受',
  401: 'API Key 无效或没有权限',
  402: '账户余额或额度不足',
  403: '没有访问权限',
  404: '接口地址不存在，请检查 Base URL',
  413: '请求内容过长',
  429: '请求太频繁或额度不足',
  500: '服务商服务器暂时出错',
  502: '服务商服务器暂时出错',
  503: '服务商服务暂时不可用',
  504: '服务商响应超时',
}

/** Pull the human-readable sentence a vendor embeds in an error body, if any. */
export function vendorErrorMessage(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return ''
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }, message?: unknown }
    const detail = typeof parsed.error?.message === 'string'
      ? parsed.error.message
      : typeof parsed.message === 'string' ? parsed.message : ''
    return detail.trim().replace(/\s+/gu, ' ').slice(0, 200)
  } catch {
    return ''
  }
}

/** Turn an HTTP failure into a sentence a non-technical user can act on. */
export function httpFailureMessage(prefix: string, status: number, statusText: string, body: string): string {
  const hint = STATUS_HINTS[status]
  const base = hint !== undefined
    ? `${hint}（HTTP ${String(status)}）`
    : `HTTP ${String(status)}${statusText === '' ? '' : ` ${statusText}`}`
  const vendor = vendorErrorMessage(body)
  return `${prefix}：${base}${vendor === '' ? '' : `：${vendor}`}`
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /operation was aborted/iu.test(error.message))
}
