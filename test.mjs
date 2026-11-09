import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildShorekeeperPrompt,
  createShorekeeperPersonaPlugin,
  latestUserText,
  shouldReadPersonaFile,
} from './persona.mjs'
import {
  createShorekeeperTtsPlugin,
  createSpeechBuffer,
  loadInworldApiKey,
  synthesize,
  visibleText,
} from './plugin.mjs'

const repeat = (text, count) => text.repeat(count)

test('extracts only visible assistant text blocks', () => {
  assert.equal(visibleText([
    { type: 'reasoning', text: 'hidden' },
    { type: 'text', text: 'Hello ' },
    { type: 'tool-call', id: 'tool' },
    { type: 'text', text: 'world' },
  ]), 'Hello world')
})

test('keeps short sentences together until a later delimiter passes 20 characters', () => {
  const buffer = createSpeechBuffer()
  assert.deepEqual(buffer.push(`${repeat('字', 19)}。`), [])
  assert.deepEqual(buffer.finish(), [`${repeat('字', 19)}。`])

  const joined = createSpeechBuffer()
  assert.deepEqual(joined.push(`${repeat('字', 19)}。`), [])
  assert.deepEqual(joined.push(`${repeat('字', 20)}\n`), [`${repeat('字', 19)}。${repeat('字', 20)}`])
  assert.deepEqual(joined.push(`${repeat('句', 21)}。`), [`${repeat('句', 21)}。`])
  assert.deepEqual(joined.finish(), [])
})

test('splits on the next period or newline only after the spoken length passes 20', () => {
  const buffer = createSpeechBuffer()
  assert.deepEqual(buffer.push(`${repeat('字', 21)}。${repeat('句', 21)}。`), [
    `${repeat('字', 21)}。`,
    `${repeat('句', 21)}。`,
  ])
  assert.deepEqual(buffer.push(`${repeat('行', 21)}\n${repeat('尾', 3)}`), [`${repeat('行', 21)}`])
  assert.deepEqual(buffer.push(`${repeat('，', 30)}`), [])
  assert.deepEqual(buffer.finish(), [`${repeat('尾', 3)}${repeat('，', 30)}`])
})

test('drops fenced code and joins the prose around it', () => {
  const buffer = createSpeechBuffer()
  const spoken = [
    ...buffer.push('前文留下。\n```js\nconsole.log("hi.")\n~~~\nnot a close\n```\n'),
    ...buffer.push(`${repeat('后', 21)}。`),
    ...buffer.finish(),
  ].join('')
  assert.equal(spoken.includes('console'), false)
  assert.equal(spoken.includes('not a close'), false)
  assert.equal(spoken.includes('前文留下。'), true)
  assert.equal(spoken.includes(repeat('后', 21)), true)
})

test('tilde fences are silent and a mid-line fence marker stays prose', () => {
  const buffer = createSpeechBuffer()
  const spoken = [
    ...buffer.push(`看这段\`\`\`${repeat('字', 21)}。\n~~~\nhidden。\n~~~\n`),
    ...buffer.finish(),
  ].join('')
  assert.equal(spoken.includes('hidden'), false)
  assert.equal(spoken.includes('```'), true)
  assert.equal(spoken.includes(repeat('字', 21)), true)
})

function mountPlugin(options) {
  const handlers = new Map()
  let command
  let api
  const apply = createShorekeeperTtsPlugin({
    hotkey: false,
    onReady(value) { api = value },
    ...options,
  })
  apply({
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    commands: {
      register(value) {
        command = value
        return () => {}
      },
    },
  })
  return {
    command,
    api,
    emit(payload) {
      for (const handler of handlers.get('agent/assistant-stream') ?? []) handler(payload)
    },
  }
}

test('reads text deltas, finishes the tail once, and ignores reasoning and tool arguments', async () => {
  const spoken = []
  const mounted = mountPlugin({
    getApiKey: () => 'test-key',
    synthesizeAudio: async text => Buffer.from(text),
    playAudio: async audio => { spoken.push(audio.toString()) },
  })
  const chunk = inner => mounted.emit({ frame: { type: 'chunk', chunk: inner } })
  chunk({ type: 'reasoning-delta', text: `${repeat('想', 30)}。` })
  chunk({ type: 'tool-call-delta', argumentsDelta: `${repeat('参', 30)}。` })
  chunk({ type: 'text-delta', text: repeat('文', 8) })
  chunk({ type: 'block-end', block: { type: 'text', text: 'ignored full block' } })
  mounted.emit({ frame: { type: 'end' } })
  await mounted.api.whenIdle()
  assert.deepEqual(spoken, [repeat('文', 8)])
})

test('synthesizes the next sentence while the previous one is still playing', async () => {
  const synths = []
  const plays = []
  const sentence = mark => `${repeat(mark, 21)}。`
  const mounted = mountPlugin({
    getApiKey: () => 'test-key',
    synthesizeAudio: text => new Promise(resolve => { synths.push({ text, resolve }) }),
    playAudio: audio => new Promise(resolve => { plays.push({ audio, resolve }) }),
  })
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${sentence('甲')}${sentence('乙')}` } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(synths.length, 1)
  synths[0].resolve(Buffer.from(synths[0].text))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(plays.length, 1)
  assert.equal(synths.length, 2)
  assert.equal(plays[0].audio.toString(), sentence('甲'))
  synths[1].resolve(Buffer.from(synths[1].text))
  plays[0].resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(plays.length, 2)
  assert.equal(plays[1].audio.toString(), sentence('乙'))
  plays[1].resolve()
  await mounted.api.whenIdle()
})

test('/shush drops unspoken text and stops the current playback', async () => {
  const synthesized = []
  let killed = false
  const mounted = mountPlugin({
    getApiKey: () => 'test-key',
    synthesizeAudio: async text => {
      synthesized.push(text)
      return Buffer.from(text)
    },
    playAudio: (_audio, controls) => new Promise(resolve => {
      controls.bindStop(() => {
        killed = true
        resolve()
      })
    }),
  })
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${repeat('甲', 21)}。尾巴` } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mounted.command.name, 'shush')
  assert.deepEqual(mounted.command.handler(), { kind: 'success', text: '已经停下。' })
  assert.equal(killed, true)
  mounted.emit({ frame: { type: 'end' } })
  await mounted.api.whenIdle()
  assert.deepEqual(synthesized, [`${repeat('甲', 21)}。`])
  assert.equal(synthesized.some(text => text.includes('尾巴')), false)
})

test('sends the Shorekeeper voice and normal speaking rate to Inworld', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return new Response(`${JSON.stringify({ result: { audioContent: Buffer.from('mp3').toString('base64') } })}\n`, { status: 200 })
  }
  const audio = await synthesize('hello', 'test-key', fetchImpl)

  assert.equal(audio.toString(), 'mp3')
  assert.equal(request.url, 'https://api.inworld.ai/tts/v1/voice:stream')
  assert.equal(request.init.headers.Authorization, 'Basic test-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    text: 'hello',
    voice_id: 'sunny-fern-4510__shorekeeper-pro',
    model_id: 'inworld-tts-2',
    audio_config: { audio_encoding: 'MP3', speaking_rate: 1 },
    delivery_mode: 'BALANCED',
    language: 'AUTO',
  })
})

test('reads the Inworld key from the environment before ~/.dsh/.env', () => {
  assert.equal(loadInworldApiKey({
    env: { INWORLD_API_KEY: 'from-env' },
    readFile: () => 'INWORLD_API_KEY="file=="',
  }), 'from-env')
  assert.equal(loadInworldApiKey({
    env: {},
    readFile: () => '# comment\nexport INWORLD_API_KEY="abc=="\n',
  }), 'abc==')
  assert.equal(loadInworldApiKey({
    env: {},
    readFile: () => { throw new Error('missing') },
  }), '')
})

test('persona prompt keeps love and punctuation, and leaves the catalogs out', () => {
  const prompt = buildShorekeeperPrompt({
    userText: '今天写一段代码',
    date: new Date(2026, 10, 9, 10, 0, 0),
    take: lines => lines.slice(0, 4),
  })
  assert.equal(prompt.includes('她非常爱漂泊者'), true)
  assert.equal(prompt.includes('正在说话的用户就是漂泊者。守岸人非常爱漂泊者。'), true)
  assert.equal(prompt.includes('日常回复必须写出中文逗号「，」和句号「。」。'), true)
  assert.equal(prompt.includes('用观测、记录、频率、潮汐这些词描述自己和生活，包括感情。'), true)
  assert.equal(prompt.includes('数据、条目、潮汐'), false)
  assert.equal(prompt.includes('这一轮用户的话碰到了这些设定'), false)
  assert.equal(prompt.includes('上午好。有什么需要我协助确认的吗？'), true)
  assert.equal(prompt.includes('你似乎有些心事。若愿意，我会听。'), true)
  assert.equal(prompt.includes('我整理了几个可行方向。选择仍然属于你。'), false)
  assert.equal(prompt.includes('漂泊者，若你回头，我会在那里。'), true)
  assert.equal(prompt.includes('你让我拥有了“想要”的意义。对此，我很珍惜。'), true)
  assert.equal(prompt.includes('即使潮水改变方向'), false)
  assert.equal(prompt.includes('你好。这里是黑海岸，请说明你的来意。'), false)
  assert.equal(prompt.includes('亲密不等于恋爱'), false)
  assert.equal(prompt.includes('我收录过风雨、鸟鸣与鲸歌'), false)
  assert.equal(prompt.includes('## 情绪表达'), false)
  assert.equal(prompt.includes('## 绝对不用'), false)
  assert.equal(prompt.includes('{{char}}'), true)
  assert.equal(prompt.includes('{char}'), true)
  assert.equal(prompt.includes('{{user}}'), true)
  assert.equal(prompt.includes('{user}'), true)
  const coast = '黑海岸是索拉里斯观测悲鸣周期的最权威组织'
  assert.equal(prompt.split(coast).length - 1, 2)
  assert.ok(prompt.length > 5000 && prompt.length < 6000, `prompt length ${prompt.length}`)
  const names = readdirSync(new URL('./packages/shorekeeper-persona/shorekeeper-source/personas/', import.meta.url))
  assert.equal(names.some(name => name.includes('越狱')), false)
  assert.equal(shouldReadPersonaFile('90-越狱.md'), false)
  assert.equal(readFileSync(new URL('./packages/shorekeeper-persona/shorekeeper-source/personas/01-语气.md', import.meta.url), 'utf8').includes('## 情绪表达'), true)
})

test('keyword hits keep world text before the card, with the card ordered by insertion', () => {
  const prompt = buildShorekeeperPrompt({
    userText: '我想听你弹钢琴，索诺拉是什么',
    date: new Date(2026, 10, 9, 10, 0, 0),
    take: lines => lines.slice(0, 4),
  })
  const parts = prompt.split('\n\n')
  const intro = parts.indexOf('这一轮用户的话碰到了这些设定。用平常的句子讲，不要分条，也不要说这是第几条。')
  assert.ok(intro > 0)
  assert.equal(parts[intro + 1].startsWith('{{char}} 在 {{user}} 离开前学会了弹钢琴'), true)
  assert.equal(parts[intro + 2].startsWith('{{char}} 有情感上的缺陷'), true)
  assert.equal(parts[intro + 3].startsWith('{{char}} 有情感上的缺陷'), true)
  assert.equal(parts[intro + 4].startsWith('{{char}} 在 {{user}} 离开前学会了弹钢琴'), true)
})

test('registers one literal simulation section and reads the latest human message', () => {
  let section
  createShorekeeperPersonaPlugin({
    now: () => new Date(2026, 10, 9, 10, 0, 0),
    take: lines => lines.slice(0, 4),
  })({
    systemPrompt: {
      section(value) { section = value },
    },
  })
  assert.equal(section.name, 'shorekeeper:simulation')
  assert.equal(section.order, 10)
  assert.equal(section.interpolate, false)
  assert.equal(section.text({}).includes('这一轮用户的话碰到了这些设定'), false)

  const session = {
    events: [{ type: 'user/message', data: { content: [{ type: 'text', text: '旧的钢琴' }] } }],
    snapshotEvents: () => [
      { type: 'user/message', data: { content: [{ type: 'text', text: '我想听钢琴' }], source: { kind: 'user' } } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '工具回执' }], source: { kind: 'plugin' } } },
    ],
  }
  assert.equal(latestUserText(session), '我想听钢琴')
  assert.equal(section.text({ agent: { session } }).includes('离开前学会了弹钢琴'), true)
  assert.equal(section.text({ agent: { session: {} } }).includes('这一轮用户的话碰到了这些设定'), false)
})

test('web patch turns off the harness opener and mounts both plugins', () => {
  const patch = readFileSync(new URL('./cordis.yml', import.meta.url), 'utf8')
  assert.equal(patch.includes('includeHarnessIdentity: false'), true)
  assert.equal(patch.includes("personaPrefix: ''"), true)
  assert.equal(patch.includes("'./plugin.mjs'"), true)
  assert.equal(patch.includes("'./persona.mjs'"), true)
})
