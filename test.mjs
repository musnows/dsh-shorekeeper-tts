import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildShorekeeperPrompt,
  createShorekeeperPersonaPlugin,
  latestUserText,
  shouldReadPersonaFile,
} from './persona.mjs'
import {
  Config,
  assistantMessageTextFromEvents,
  createShorekeeperTtsPlugin,
  createSpeechBuffer,
  loadInworldApiKey,
  minSpokenOf,
  petRoot,
  sentencesForReplay,
  snapMinSpoken,
  afplayArgs,
  playMp3,
  snapSpeakingRate,
  snapVolume,
  speakingRateOf,
  speechEnabledOf,
  synthesize,
  volumeOf,
  visibleText,
} from './plugin.mjs'

const repeat = (text, count) => text.repeat(count)
const longSentence = (mark, count = 31) => `${repeat(mark, count)}。`

test('extracts only visible assistant text blocks', () => {
  assert.equal(visibleText([
    { type: 'reasoning', text: 'hidden' },
    { type: 'text', text: 'Hello ' },
    { type: 'tool-call', id: 'tool' },
    { type: 'text', text: 'world' },
  ]), 'Hello world')
})

test('keeps short sentences together until a later delimiter passes 30 characters', () => {
  const buffer = createSpeechBuffer()
  assert.deepEqual(buffer.push(`${repeat('字', 29)}。`), [])
  assert.deepEqual(buffer.finish(), [`${repeat('字', 29)}。`])

  const joined = createSpeechBuffer()
  assert.deepEqual(joined.push(`${repeat('字', 29)}。`), [])
  assert.deepEqual(joined.push(`${repeat('字', 30)}\n`), [`${repeat('字', 29)}。${repeat('字', 30)}`])
  assert.deepEqual(joined.push(`${repeat('句', 31)}。`), [`${repeat('句', 31)}。`])
  assert.deepEqual(joined.finish(), [])
})

test('splits on the next period or newline only after the spoken length passes the threshold', () => {
  const buffer = createSpeechBuffer()
  assert.deepEqual(buffer.push(`${repeat('字', 31)}。${repeat('句', 31)}。`), [
    `${repeat('字', 31)}。`,
    `${repeat('句', 31)}。`,
  ])
  assert.deepEqual(buffer.push(`${repeat('行', 31)}\n${repeat('尾', 3)}`), [`${repeat('行', 31)}`])
  assert.deepEqual(buffer.push(`${repeat('，', 30)}`), [])
  assert.deepEqual(buffer.finish(), [`${repeat('尾', 3)}${repeat('，', 30)}`])

  const custom = createSpeechBuffer({ minSpoken: 20 })
  assert.deepEqual(custom.push(`${repeat('字', 19)}。`), [])
  assert.deepEqual(custom.push(`${repeat('字', 20)}\n`), [`${repeat('字', 19)}。${repeat('字', 20)}`])
})

test('drops fenced code and joins the prose around it', () => {
  const buffer = createSpeechBuffer()
  const spoken = [
    ...buffer.push('前文留下。\n```js\nconsole.log("hi.")\n~~~\nnot a close\n```\n'),
    ...buffer.push(`${repeat('后', 31)}。`),
    ...buffer.finish(),
  ].join('')
  assert.equal(spoken.includes('console'), false)
  assert.equal(spoken.includes('not a close'), false)
  assert.equal(spoken.includes('前文留下。'), true)
  assert.equal(spoken.includes(repeat('后', 31)), true)
})

test('tilde fences are silent and a mid-line fence marker stays prose', () => {
  const buffer = createSpeechBuffer()
  const spoken = [
    ...buffer.push(`看这段\`\`\`${repeat('字', 31)}。\n~~~\nhidden。\n~~~\n`),
    ...buffer.finish(),
  ].join('')
  assert.equal(spoken.includes('hidden'), false)
  assert.equal(spoken.includes('```'), true)
  assert.equal(spoken.includes(repeat('字', 31)), true)
})

function mountPlugin(options = {}) {
  const handlers = new Map()
  let command
  let api
  const { config, ...pluginOptions } = options
  const apply = createShorekeeperTtsPlugin({
    hotkey: false,
    onReady(value) { api = value },
    ...pluginOptions,
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
  }, config)
  return {
    command,
    api,
    emit(payload) {
      for (const handler of handlers.get('agent/assistant-stream') ?? []) handler(payload)
    },
    emitEvent(name, ...args) {
      for (const handler of handlers.get(name) ?? []) handler(...args)
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
  const mounted = mountPlugin({
    getApiKey: () => 'test-key',
    synthesizeAudio: text => new Promise(resolve => { synths.push({ text, resolve }) }),
    playAudio: audio => new Promise(resolve => { plays.push({ audio, resolve }) }),
  })
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${longSentence('甲')}${longSentence('乙')}` } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(synths.length, 1)
  synths[0].resolve(Buffer.from(synths[0].text))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(plays.length, 1)
  assert.equal(synths.length, 2)
  assert.equal(plays[0].audio.toString(), longSentence('甲'))
  synths[1].resolve(Buffer.from(synths[1].text))
  plays[0].resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(plays.length, 2)
  assert.equal(plays[1].audio.toString(), longSentence('乙'))
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
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${longSentence('甲')}尾巴` } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mounted.command.name, 'shush')
  assert.deepEqual(mounted.command.handler(), { kind: 'success', text: '已经停下。' })
  assert.equal(killed, true)
  mounted.emit({ frame: { type: 'end' } })
  await mounted.api.whenIdle()
  assert.deepEqual(synthesized, [longSentence('甲')])
  assert.equal(synthesized.some(text => text.includes('尾巴')), false)
})

test('snaps speaking rate to tenths between 0.8 and 1.5', async () => {
  assert.equal(snapSpeakingRate(0.11), 0.8)
  assert.equal(snapSpeakingRate(0.79), 0.8)
  assert.equal(snapSpeakingRate(1.14), 1.1)
  assert.equal(snapSpeakingRate(1.16), 1.2)
  assert.equal(snapSpeakingRate(2), 1.5)
  assert.equal(snapSpeakingRate('fast'), 1)
  assert.throws(() => Config({ speakingRate: 1.11 }))
  assert.throws(() => Config({ speakingRate: 0.7 }))
  assert.equal(Config({ speakingRate: 1.2 }).speakingRate.get(), 1.2)
  assert.equal(speakingRateOf(undefined), 1)

  let request
  const fetchImpl = async (_url, init) => {
    request = init
    return new Response(`${JSON.stringify({ result: { audioContent: Buffer.from('mp3').toString('base64') } })}\n`, { status: 200 })
  }
  await synthesize('hello', 'test-key', fetchImpl, { speakingRate: 0.11 })
  assert.equal(JSON.parse(request.body).audio_config.speaking_rate, 0.8)

  let current = 1
  const seen = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const mounted = mountPlugin({
    config: { speakingRate: { get: () => current } },
    getApiKey: () => 'test-key',
    synthesizeAudio: async (text, _key, _fetch, options) => {
      seen.push(options.speakingRate)
      if (seen.length === 1) await firstGate
      return Buffer.from(text)
    },
    playAudio: async () => {},
  })
  mounted.emit({
    frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${longSentence('甲')}${longSentence('乙')}` } },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(seen, [1])
  current = 1.4
  releaseFirst()
  await mounted.api.whenIdle()
  assert.deepEqual(seen, [1, 1.4])
})

test('resolves the bundled realtime pet next to the TTS package', () => {
  const root = petRoot()
  assert.ok(root)
  assert.equal(existsSync(join(root, 'server.mjs')), true)
  assert.equal(existsSync(join(root, 'mac', 'main.swift')), true)
  assert.equal(existsSync(join(root, 'mac', 'Info.plist')), true)
  assert.match(root, /packages\/shorekeeper-tts\/realtime-demo$/)
})

test('snaps min spoken length to fives between 20 and 50', () => {
  assert.equal(snapMinSpoken(19), 20)
  assert.equal(snapMinSpoken(22), 20)
  assert.equal(snapMinSpoken(23), 25)
  assert.equal(snapMinSpoken(33), 35)
  assert.equal(snapMinSpoken(51), 50)
  assert.equal(snapMinSpoken('slow'), 30)
  assert.throws(() => Config({ minSpoken: 21 }))
  assert.throws(() => Config({ minSpoken: 15 }))
  assert.equal(Config({}).minSpoken.get(), 30)
  assert.equal(Config({ minSpoken: 40 }).minSpoken.get(), 40)
  assert.equal(minSpokenOf(undefined), 30)
  assert.equal(minSpokenOf({ minSpoken: { get: () => 22 } }), 20)
})

test('replays a finalized assistant message as full spoken sentences', async () => {
  assert.deepEqual(
    assistantMessageTextFromEvents([
      { type: 'assistant/message', data: { message: { id: 'm1', content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: longSentence('甲') }] } } },
    ], 'm1'),
    { messageId: 'm1', text: longSentence('甲') },
  )
  assert.equal(assistantMessageTextFromEvents([], 'missing'), null)
  assert.deepEqual(sentencesForReplay(`${longSentence('甲')}${longSentence('乙')}`, 30), [
    longSentence('甲'),
    longSentence('乙'),
  ])

  const spoken = []
  let api
  const agents = new Map([['session-1', {
    session: {
      snapshotEvents: () => [{
        type: 'assistant/message',
        data: { message: { id: 'msg-1', content: [{ type: 'text', text: `${longSentence('重')}${longSentence('播')}` }] } },
      }],
    },
  }]])
  let rpcHandler
  const apply = createShorekeeperTtsPlugin({
    hotkey: false,
    onReady(value) { api = value },
    getApiKey: () => 'test-key',
    synthesizeAudio: async text => Buffer.from(text),
    playAudio: async audio => { spoken.push(audio.toString()) },
  })
  apply({
    agents,
    on() {},
    commands: { register() { return () => {} } },
    inject(deps, callback) {
      assert.deepEqual(deps, ['connection', 'webServer'])
      callback({
        webServer: { register() { return () => {} } },
        connection: {
          rpc: {
            handle(channel, handler) {
              assert.equal(channel, '/shorekeeper-tts')
              rpcHandler = handler
              return () => {}
            },
          },
        },
        on() {},
      })
    },
  }, {})
  const result = await rpcHandler('speak', { sessionId: 'session-1', messageId: 'msg-1' })
  assert.equal(result.ok, true)
  await api.whenIdle()
  assert.deepEqual(spoken, [longSentence('重'), longSentence('播')])
})

test('snaps playback volume to tenths between 0 and 1', async () => {
  assert.equal(snapVolume(0.14), 0.1)
  assert.equal(snapVolume(0.16), 0.2)
  assert.equal(snapVolume(-1), 0)
  assert.equal(snapVolume(2), 1)
  assert.equal(snapVolume('loud'), 1)
  assert.throws(() => Config({ volume: 0.11 }))
  assert.throws(() => Config({ volume: 1.1 }))
  assert.equal(Config({}).volume.get(), 1)
  assert.equal(Config({ volume: 0.5 }).volume.get(), 0.5)
  assert.equal(volumeOf(undefined), 1)
  assert.deepEqual(afplayArgs('/tmp/line.mp3', 0.24), ['-v', '0.2', '/tmp/line.mp3'])

  const calls = []
  await playMp3(Buffer.from('mp3'), {
    volume: 0.24,
    spawn(command, args) {
      calls.push([command, args])
      return {
        kill() {},
        once(event, callback) {
          if (event === 'exit') queueMicrotask(() => callback(0))
        },
      }
    },
  })
  assert.match(calls[0][0], /(^|\/)afplay$/)
  assert.equal(calls[0][1][0], '-v')
  assert.equal(calls[0][1][1], '0.2')

  let current = 0.4
  const seen = []
  let releaseFirst
  const mounted = mountPlugin({
    config: { volume: { get: () => current } },
    getApiKey: () => 'test-key',
    synthesizeAudio: async text => Buffer.from(text),
    playAudio: (_audio, controls) => new Promise(resolve => {
      seen.push(controls.volume)
      if (seen.length === 1) releaseFirst = resolve
      else resolve()
    }),
  })
  mounted.emit({
    frame: { type: 'chunk', chunk: { type: 'text-delta', text: `${longSentence('甲')}${longSentence('乙')}` } },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(seen, [0.4])
  current = 0.9
  releaseFirst()
  await mounted.api.whenIdle()
  assert.deepEqual(seen, [0.4, 0.9])
})

test('turning speech off stops playback and drops later sentences', async () => {
  assert.equal(speechEnabledOf(undefined), true)
  assert.equal(Config({}).enabled.get(), true)
  assert.equal(Config({ enabled: false }).enabled.get(), false)
  assert.equal(Config({}).inputGate.get(), 0.012)

  let enabled = true
  const synthesized = []
  let killed = false
  const mounted = mountPlugin({
    config: {
      enabled: { get: () => enabled },
      speakingRate: { get: () => 1 },
    },
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
  const sentence = longSentence('甲')
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: sentence } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(synthesized, [sentence])
  enabled = false
  mounted.emitEvent('loader/volatile-update', [['enabled']])
  assert.equal(killed, true)
  mounted.emit({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: longSentence('乙') } } })
  mounted.emit({ frame: { type: 'end' } })
  await mounted.api.whenIdle()
  assert.deepEqual(synthesized, [sentence])
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
    synthesis_context: { reasoning: 'REASONING_ON' },
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
  assert.equal(patch.includes('id: 守岸人语音'), true)

  const manifest = JSON.parse(readFileSync(new URL('./packages/shorekeeper-tts/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  const client = readFileSync(new URL('./packages/shorekeeper-tts/client.js', import.meta.url), 'utf8')
  assert.equal(client.includes("id: 'shorekeeper-speaking-rate'"), true)
  assert.equal(client.includes("'@dsh-local/shorekeeper-tts#守岸人语音'"), true)
  assert.equal(client.includes('shorekeeper-speaking-rate-v13'), true)
  assert.equal(client.includes('语速 0.8x–1.5x · 音量 0–1 · 起送 20–50 字'), true)
  assert.equal(client.includes('音量'), true)
  assert.equal(client.includes('起送字数'), true)
  assert.equal(client.includes('minSpoken'), true)
  assert.equal(client.includes('关闭播报'), true)
  assert.equal(client.includes('语音播报'), true)
  assert.equal(client.includes("name: 'shorekeeper.theme.pet'"), true)
  assert.equal(client.includes('打开后停在屏幕上，可以随时关掉'), true)
  assert.equal(client.includes('收音阈值'), true)
  assert.equal(client.includes("className: 'dshsk-range'"), true)
  assert.equal(client.includes('aria-label\': \'麦克风\''), true)
  assert.equal(client.includes('识别模型'), true)
  assert.equal(client.includes('soniox/stt-rt-v4'), true)
  assert.equal(client.includes("role: 'switch'"), true)
  assert.equal(client.includes("id: 'shorekeeper-speak'"), true)
  assert.equal(client.includes('conversation.chat.assistant-actions'), true)
  assert.equal(client.includes('语音重播'), true)
  assert.equal(client.includes('sessionsApi.refresh'), true)
  assert.equal(client.includes("ctx.get?.('sessions')"), true)
  assert.equal(client.includes('ctx.sessions'), false)
})

test('publishes a new session id only to the loopback hook', async () => {
  const { createServer } = await import('node:http')
  const { publishNewSession, setSessionHook } = await import('./packages/shorekeeper-tts/realtime-demo/sessions.mjs')
  const seen = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      response.writeHead(200)
      response.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const id = 'session-202367c0-d7c7-4432-b9d9-2ef49799fbff'
  try {
    setSessionHook(`http://127.0.0.1:${port}/session`)
    assert.equal(await publishNewSession(id, '/tmp/project'), true)
    assert.equal(await publishNewSession(id, '/tmp/project'), false)
    setSessionHook('http://example.com/session')
    const other = 'session-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    assert.equal(await publishNewSession(other, '/tmp/project'), true)
    setSessionHook('')
    assert.equal(await publishNewSession('session-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', '/tmp/project'), false)
  } finally {
    setSessionHook('')
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
  assert.deepEqual(seen.map(item => item.id), [id, 'session-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
  assert.equal(seen[0].cwd, '/tmp/project')
})

test('theme source ships in this repo at 0.1.1 with the pet slot', () => {
  const manifest = JSON.parse(readFileSync(new URL('./packages/shorekeeper-theme/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-shorekeeper-startup')
  assert.equal(manifest.version, '0.1.1')
  assert.equal(manifest.exports['./client'], './client.js')
  const patch = readFileSync(new URL('./cordis.yml', import.meta.url), 'utf8')
  assert.equal(patch.includes("'./packages/shorekeeper-theme/index.js'"), true)
  for (const file of ['client.js', 'client.template.js']) {
    const source = readFileSync(new URL(`./packages/shorekeeper-theme/${file}`, import.meta.url), 'utf8')
    assert.equal(source.includes("renderSlot('shorekeeper.theme.pet')"), true)
    assert.equal(source.includes("'shorekeeper.theme.pet': { kind: 'single', scope: 'root' }"), true)
  }
})

test('reads the DeepSeek key the same way the LLM does', async () => {
  const { loadDeepseekApiKey } = await import('./packages/shorekeeper-tts/realtime-demo/search.mjs')
  const credentials = [
    'version: 1',
    'DEEPSEEK_API_KEY: not-this',
    'refs:',
    '  OTHER_KEY: other',
    '  DEEPSEEK_API_KEY: "from-refs"',
    'records:',
    '  llm/deepseek: ignore',
  ].join('\n')
  const envFile = 'DEEPSEEK_API_KEY=from-dotenv\n'
  const readFile = (path) => {
    if (String(path).endsWith('.credentials.yaml')) return credentials
    if (String(path).endsWith('.env')) return envFile
    throw new Error('missing')
  }
  assert.equal(loadDeepseekApiKey({
    env: { DEEPSEEK_API_KEY: 'from-env', DSH_HOME: '/tmp/dsh' },
    readFile,
  }), 'from-env')
  assert.equal(loadDeepseekApiKey({
    env: { DSH_HOME: '/tmp/dsh' },
    readFile,
  }), 'from-refs')
  assert.equal(loadDeepseekApiKey({
    env: { DSH_HOME: '/tmp/dsh' },
    readFile: (path) => {
      if (String(path).endsWith('.credentials.yaml')) return 'version: 1\nrefs:\n  DEEPSEEK_API_KEY:\n'
      return envFile
    },
  }), 'from-dotenv')
  assert.equal(loadDeepseekApiKey({
    env: {},
    readFile: () => { throw new Error('missing') },
  }), '')
})

test('web_search calls the DeepSeek search API with the LLM token', async () => {
  const { SEARCH_URL, webSearch } = await import('./packages/shorekeeper-tts/realtime-demo/search.mjs')
  const server = readFileSync('./packages/shorekeeper-tts/realtime-demo/server.mjs', 'utf8')
  assert.equal(server.includes("name: 'web_search'"), true)
  assert.equal(server.includes('先调用 web_search'), true)
  assert.equal(server.includes('https://api.deepseek.com'), false)

  let request
  const output = await webSearch({
    query: '守岸人',
    question: '她现在的版本是什么',
    apiKey: 'sk-test',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            title: '守岸人',
            url: 'https://example.com/shorekeeper',
            site_name: 'Example',
            summary: '一句摘要。',
            content: '整页正文不该出现在工具结果里。',
          }],
        }),
      }
    },
  })

  assert.equal(request.url, SEARCH_URL)
  assert.equal(request.init.headers.Authorization, 'Bearer sk-test')
  const body = JSON.parse(request.init.body)
  assert.equal(body.query, '守岸人')
  assert.equal(body.ori_question, '她现在的版本是什么')
  assert.equal(body.count, 5)
  assert.equal(output.includes('守岸人'), true)
  assert.equal(output.includes('https://example.com/shorekeeper'), true)
  assert.equal(output.includes('整页正文'), false)
  assert.equal(output.includes('sk-test'), false)

  assert.equal(await webSearch({ query: '   ', apiKey: 'sk-test', fetchImpl: async () => { throw new Error('no') } }), '没有搜索词。')
  let called = false
  const longQuery = '守岸人'.repeat(80)
  const tooLong = await webSearch({
    query: longQuery,
    question: '她现在的版本是什么',
    apiKey: 'sk-test',
    fetchImpl: async () => { called = true },
  })
  assert.equal(called, false)
  assert.equal(tooLong, 'query is 240 characters, over the 120-character limit. Shorten query to 120 characters or fewer and call web_search again. Do not retry this same text.')
  const atLimit = 'a'.repeat(120)
  const sent = await webSearch({
    query: atLimit,
    apiKey: 'sk-test',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return { ok: true, json: async () => ({ results: [] }) }
    },
  })
  assert.equal(JSON.parse(request.init.body).query, atLimit)
  assert.equal(sent, '没有搜到。')
  const longQuestion = await webSearch({
    query: '守岸人',
    question: '问'.repeat(121),
    apiKey: 'sk-test',
    fetchImpl: async () => { called = true },
  })
  assert.equal(called, false)
  assert.match(longQuestion, /^question is 121 characters, over the 120-character limit\. Shorten question/)
  assert.equal(server.includes('maxLength: 120'), true)
  assert.equal(await webSearch({ query: '天气', apiKey: '', fetchImpl: async () => { throw new Error('no') } }), '没有 DeepSeek 的密钥，搜不了。')
  assert.equal(await webSearch({
    query: '天气',
    apiKey: 'sk-test',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  }), 'DeepSeek 密钥无效，搜不了。')
  assert.equal(await webSearch({
    query: '天气',
    apiKey: 'sk-test',
    fetchImpl: async () => { throw new Error('offline') },
  }), '搜索没有连上。')
  assert.equal(await webSearch({
    query: '天气',
    apiKey: 'sk-test',
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }),
  }), '没有搜到。')
})

test('phone companion can type on the realtime socket without moving the pet off loopback', () => {
  const server = readFileSync('./packages/shorekeeper-tts/realtime-demo/server.mjs', 'utf8')
  assert.equal(server.includes("message.type === 'text'"), true)
  assert.equal(server.includes('input_text'), true)
  assert.equal(server.includes("pathname === '/health'"), true)
  assert.equal(server.includes('SHOREKEEPER_HOST'), true)
  assert.equal(server.includes("server.listen(PORT, HOST"), true)
  assert.equal(server.includes("server.listen(PORT, '127.0.0.1'"), false)
  assert.equal(server.includes('https://api.deepseek.com'), false)
})
