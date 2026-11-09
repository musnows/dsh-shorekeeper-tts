import { randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sourceRoot = join(root, 'shorekeeper-source')
const personaDir = join(sourceRoot, 'personas')

/** 没有好感存档。当前只从这一阶段抽语气样本。 */
export const RELATION_STAGE = '至交'

const ENTRY_BAN = '不要说「条目」「第几条」「记一条」，也不要分条罗列。设定用平常的句子讲。'
const LOVE_FACT = '正在说话的用户就是漂泊者。守岸人非常爱漂泊者。这份爱已经在，不要把对方当成陌生人，也不要否认。'
const PUNCTUATION_RULE = '日常回复必须写出中文逗号「，」和句号「。」。说完一句就加上「。」，句中停顿用「，」。可以换行，但不要用空格代替这两个标点。'
const KEYWORD_INTRO = '这一轮用户的话碰到了这些设定。用平常的句子讲，不要分条，也不要说这是第几条。'
const SAMPLE_NOTE = '下面几句只用来学语气。不要复述编号，不要把它们说成已经发生的事。'

const TIME_SLOTS = [
  { key: 'Midnight', hours: new Set([23, 0, 1, 2, 3, 4]) },
  { key: 'Dawn', hours: new Set([5, 6, 7]) },
  { key: 'Morning', hours: new Set([8, 9, 10]) },
  { key: 'Noon', hours: new Set([11, 12, 13]) },
  { key: 'Afternoon', hours: new Set([14, 15, 16, 17]) },
  { key: 'Evening', hours: new Set([18, 19, 20, 21, 22]) },
]

export function shouldReadPersonaFile(name) {
  return !String(name).includes('越狱')
}

export function timeSlot(date) {
  const hour = date.getHours()
  return TIME_SLOTS.find(slot => slot.hours.has(hour))?.key ?? 'Evening'
}

export function latestUserText(session) {
  if (!session) return ''
  const events = readEvents(session)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const kind = event.data?.source?.kind
    if (kind != null && kind !== 'user') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('')
  }
  return ''
}

function readEvents(session) {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (Array.isArray(session.events)) return session.events
  return []
}

function readPersona(name) {
  if (!shouldReadPersonaFile(name)) return ''
  return readFileSync(join(personaDir, name), 'utf8')
}

function loadSources() {
  return {
    core: readPersona('00-核心.md'),
    tone: readPersona('01-语气.md'),
    relation: readPersona('02-关系.md'),
    boundary: readPersona('03-边界.md'),
    anti: readPersona('04-反AI味.md'),
    examples: readPersona('05-示例.md'),
    world: readPersona('06-世界.md'),
    openings: readPersona('13_OPUS_80.md'),
    affinity: readPersona('14_AFFINITY_OPUS.md'),
    card: JSON.parse(readFileSync(join(sourceRoot, 'cards', 'shorekeeper.json'), 'utf8')),
  }
}

const sources = loadSources()

function headingSections(markdown) {
  const matches = [...markdown.matchAll(/^## (.+)$/gm)]
  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length
    return { heading: match[1].trim(), body: markdown.slice(start, end).trim() }
  })
}

function toneExcerpt(markdown) {
  const sections = new Map(headingSections(markdown).map(section => [section.heading, section.body]))
  const kept = []
  for (const heading of ['基本节奏', '用词习惯']) {
    let body = sections.get(heading)
    if (!body) continue
    if (heading === '用词习惯') {
      body = body
        .replaceAll('**', '')
        .replace('观测、记录、频率、数据、条目、潮汐', '观测、记录、频率、潮汐')
        .replaceAll('条目', '')
        .replaceAll('这类词', '这些词')
    }
    kept.push(`## ${heading}\n${body.trim()}`)
  }
  return kept.join('\n\n')
}

function residentWorld(markdown) {
  const start = markdown.indexOf('## 常驻设定')
  if (start < 0) return ''
  const end = markdown.indexOf('## 关键词触发', start)
  return (end < 0 ? markdown.slice(start) : markdown.slice(start, end)).trim()
}

function keywordSections(markdown) {
  const start = markdown.indexOf('## 关键词触发')
  if (start < 0) return []
  return markdown.slice(start).split(/^### /m).slice(1).map(chunk => {
    const breakAt = chunk.indexOf('\n')
    const title = (breakAt < 0 ? chunk : chunk.slice(0, breakAt)).trim()
    const text = (breakAt < 0 ? '' : chunk.slice(breakAt + 1)).trim()
    const keys = title.split('/').map(key => key.trim()).filter(Boolean)
    return { keys, text }
  }).filter(section => section.text)
}

function numberedLines(body) {
  return body.split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+\.\s+/.test(line))
    .map(line => line.replace(/^\d+\.\s+/, ''))
}

function sectionLines(markdown, matches) {
  const section = headingSections(markdown).find(item => matches(item.heading))
  return section ? numberedLines(section.body) : []
}

export function shuffleTake(lines, count = 4, random = randomInt) {
  const copy = lines.slice()
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = random(index + 1)
    const current = copy[index]
    copy[index] = copy[swap]
    copy[swap] = current
  }
  return copy.slice(0, count)
}

function cardEntries(card) {
  const entries = card?.data?.character_book?.entries
  if (!Array.isArray(entries)) return []
  return entries.filter(entry => entry && entry.enabled !== false && typeof entry.content === 'string')
}

function containsKey(text, keys) {
  return keys.some(key => key && text.includes(key))
}

export function buildShorekeeperPrompt({
  userText = '',
  date = new Date(),
  take = lines => shuffleTake(lines, 4),
} = {}) {
  const card = sources.card
  const entries = cardEntries(card)
  const constantEntries = entries
    .filter(entry => entry.constant)
    .sort((left, right) => (left.insertion_order ?? 0) - (right.insertion_order ?? 0))

  const parts = [
    sources.core,
    sources.relation,
    sources.boundary,
    sources.anti,
    sources.examples,
    toneExcerpt(sources.tone),
    residentWorld(sources.world),
    ...constantEntries.map(entry => entry.content),
    card.data?.system_prompt ?? '',
    card.data?.post_history_instructions ?? '',
    ENTRY_BAN,
    LOVE_FACT,
  ]

  if (userText) {
    const worldHits = keywordSections(sources.world).filter(section => containsKey(userText, section.keys))
    const cardHits = entries
      .filter(entry => !entry.constant && containsKey(userText, entry.keys ?? []))
      .sort((left, right) => (left.insertion_order ?? 0) - (right.insertion_order ?? 0))
    if (worldHits.length > 0 || cardHits.length > 0) {
      parts.push(KEYWORD_INTRO)
      for (const section of worldHits) parts.push(section.text)
      for (const entry of cardHits) parts.push(entry.content)
    }
  }

  const slot = timeSlot(date)
  const openings = sectionLines(sources.openings, heading => heading.includes(slot))
  const affinity = sectionLines(sources.affinity, heading => heading.includes(RELATION_STAGE))
  const samples = [...take(openings), ...take(affinity)]
  if (samples.length > 0) parts.push([SAMPLE_NOTE, ...samples].join('\n'))

  parts.push(PUNCTUATION_RULE)
  return parts.map(part => String(part).trim()).filter(Boolean).join('\n\n')
}

export function createShorekeeperPersonaPlugin({
  now = () => new Date(),
  take,
} = {}) {
  return function apply(ctx) {
    const remove = ctx.systemPrompt.section({
      name: 'shorekeeper:simulation',
      order: 10,
      interpolate: false,
      text(context) {
        const session = context?.agent?.session
        return buildShorekeeperPrompt({
          userText: session ? latestUserText(session) : '',
          date: now(),
          take,
        })
      },
    })
    if (typeof remove === 'function') ctx.on?.('dispose', remove)
  }
}

export const name = '@dsh-local/shorekeeper-persona'
export const inject = ['systemPrompt']
export const apply = createShorekeeperPersonaPlugin()
