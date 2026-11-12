import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'
export const QUERY_MAX = 128
export const RESULT_COUNT = 5

export function clipUnicode(text, max) {
  return [...String(text ?? '')].slice(0, max).join('')
}

export function unquoteYamlScalar(value) {
  let text = String(value ?? '').trim()
  if (text.startsWith('"')) {
    const match = text.match(/^"((?:\\.|[^"])*)"/)
    return match ? match[1].replace(/\\"/g, '"') : ''
  }
  if (text.startsWith("'")) {
    const match = text.match(/^'([^']*)'/)
    return match ? match[1] : ''
  }
  const comment = text.indexOf(' #')
  if (comment >= 0) text = text.slice(0, comment).trim()
  return text
}

export function deepseekKeyFromCredentials(text) {
  let inRefs = false
  let refsIndent = 0
  for (const raw of String(text ?? '').split(/\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^ */)?.[0].length ?? 0
    const trimmed = raw.trim()
    if (!inRefs) {
      if (/^refs\s*:/.test(trimmed)) {
        inRefs = true
        refsIndent = indent
      }
      continue
    }
    if (indent <= refsIndent) {
      inRefs = false
      continue
    }
    const match = trimmed.match(/^DEEPSEEK_API_KEY\s*:\s*(.*)$/)
    if (!match) continue
    return unquoteYamlScalar(match[1])
  }
  return ''
}

export function loadDeepseekApiKey({
  env = process.env,
  credentialsPath = join(env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml'),
  envPath = join(env.DSH_HOME || join(homedir(), '.dsh'), '.env'),
  readFile = readFileSync,
  parseEnv = null,
} = {}) {
  const fromEnv = env.DEEPSEEK_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const fromCredentials = deepseekKeyFromCredentials(readFile(credentialsPath, 'utf8'))
    if (fromCredentials) return fromCredentials
  } catch { /* missing file */ }
  try {
    const text = readFile(envPath, 'utf8')
    if (parseEnv) return parseEnv(text, 'DEEPSEEK_API_KEY')
    return assignment(text, 'DEEPSEEK_API_KEY')
  } catch {
    return ''
  }
}

function assignment(text, name) {
  for (const rawLine of String(text).split(/\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const splitAt = body.indexOf('=')
    if (splitAt < 0 || body.slice(0, splitAt).trim() !== name) continue
    let value = body.slice(splitAt + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1)
    return value
  }
  return ''
}

export function formatSearchResults(results) {
  const rows = Array.isArray(results) ? results.slice(0, RESULT_COUNT) : []
  if (rows.length === 0) return '没有搜到。'
  return rows.map((item, index) => {
    const title = clipUnicode(item?.title || '无标题', 80)
    const site = item?.site_name ? `（${clipUnicode(item.site_name, 40)}）` : ''
    const summary = clipUnicode(item?.summary || item?.snippet || '', 400)
    const url = typeof item?.url === 'string' ? item.url : ''
    return `${index + 1}. ${title}${site}\n${summary}\n${url}`.trim()
  }).join('\n')
}

export async function webSearch({
  query,
  question,
  apiKey,
  fetchImpl = fetch,
} = {}) {
  const text = clipUnicode(String(query ?? '').trim(), QUERY_MAX).trim()
  if (!text) return '没有搜索词。'
  if (!apiKey) return '没有 DeepSeek 的密钥，搜不了。'
  const body = { query: text, count: RESULT_COUNT }
  const original = clipUnicode(String(question ?? '').trim(), QUERY_MAX).trim()
  if (original) body.ori_question = original
  let response
  try {
    response = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    return '搜索没有连上。'
  }
  if (!response?.ok) {
    if (response?.status === 401) return 'DeepSeek 密钥无效，搜不了。'
    if (response?.status === 402) return 'DeepSeek 余额不够，搜不了。'
    if (response?.status === 429) return '搜索太频繁了，等一下再问。'
    return '搜索没有成功。'
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    return '搜索结果读不出来。'
  }
  return formatSearchResults(payload?.results)
}
