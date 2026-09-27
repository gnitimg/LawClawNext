const POLICY_BLOCK = /<lawclaw-main-policy>[\s\S]*?<\/lawclaw-main-policy>\s*/giu
const USER_REQUEST = /<user-request>\s*([\s\S]*?)\s*<\/user-request>/iu

export function visibleLawClawText(value: string): string {
  const request = USER_REQUEST.exec(value)
  if (request?.[1] !== undefined) return request[1].trim()
  return value.replace(POLICY_BLOCK, '').trim()
}

export function visibleLawClawTitle(value: string): string {
  if (value.includes('<lawclaw-main-policy>') && !USER_REQUEST.test(value)) return '案件分析'
  const cleaned = visibleLawClawText(value).replace(/\s+/gu, ' ').trim()
  return cleaned === '' ? '案件分析' : cleaned
}
