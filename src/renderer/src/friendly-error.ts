/** Wrapper Electron adds around every rejected ipcRenderer.invoke. */
const IPC_METHOD_PREFIX = /^Error invoking remote method '[^']+':\s*/u

/** Error classes Node/Electron prepend before the original message. */
const ERROR_LABEL_PREFIX = /^(?:[A-Za-z]*Error|错误)(?:\s*\([^)]*\))?:\s*/u

const STATUS_HINTS: Readonly<Record<string, string>> = {
  '400': '请求参数未被服务商接受',
  '401': 'API Key 无效或没有权限',
  '402': '账户余额或额度不足',
  '403': '没有访问权限',
  '404': '接口地址不存在，请检查 Base URL',
  '429': '请求太频繁或额度不足',
  '500': '服务商服务器暂时出错',
  '502': '服务商服务器暂时出错',
  '503': '服务商服务暂时不可用',
  '504': '服务商响应超时',
}

const NETWORK_PATTERN = /Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/iu
const TIMEOUT_PATTERN = /operation was aborted|AbortError|timed?[\s-]?out/iu

export function friendlyErrorText(reason: unknown): string {
  let text = (reason instanceof Error ? reason.message : String(reason)).trim()
  text = text.replace(IPC_METHOD_PREFIX, '')
  for (let before = ''; before !== text;) {
    before = text
    text = text.replace(ERROR_LABEL_PREFIX, '')
  }

  if (NETWORK_PATTERN.test(text)) return '网络连接失败，请检查网络或接口地址后重试。'
  if (TIMEOUT_PATTERN.test(text)) return '连接超时，请稍后再试。'

  text = text.replace(/HTTP (\d{3})(?:\s+[A-Za-z]+(?:\s+[A-Za-z]+)*)?/u, (match, code: string) => {
    const hint = STATUS_HINTS[code]
    return hint === undefined ? match : `${hint}（HTTP ${code}）`
  })

  const braceIndex = text.indexOf('{')
  if (braceIndex >= 0) {
    const head = text.slice(0, braceIndex).replace(/[\s·:,，]+$/u, '').trim()
    try {
      const parsed = JSON.parse(text.slice(braceIndex)) as { error?: { message?: unknown }, message?: unknown }
      const detail = typeof parsed.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed.message === 'string' ? parsed.message : ''
      const vendor = detail.trim().replace(/\s+/gu, ' ').slice(0, 200)
      if (vendor !== '') text = head === '' ? vendor : `${head}：${vendor}`
    } catch {
      // Truncated or non-JSON payload — keep the surrounding message as-is.
    }
  }

  return text === '' ? '操作失败，请稍后再试。' : text
}
