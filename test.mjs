import assert from 'node:assert/strict'
import test from 'node:test'
import { createShorekeeperTtsPlugin, synthesize, visibleText } from './plugin.mjs'

test('extracts only visible assistant text blocks', () => {
  assert.equal(visibleText([
    { type: 'reasoning', text: 'hidden' },
    { type: 'text', text: 'Hello ' },
    { type: 'tool-call', id: 'tool' },
    { type: 'text', text: 'world' },
  ]), 'Hello world')
})

test('speaks only the final assistant message after a completed turn', async () => {
  let listener
  const spoken = []
  const apply = createShorekeeperTtsPlugin({
    getApiKey: () => 'test-key',
    synthesizeAudio: async (text, key) => {
      assert.equal(key, 'test-key')
      return Buffer.from(text)
    },
    playAudio: async audio => spoken.push(audio.toString()),
  })
  apply({ on: (event, handler) => { assert.equal(event, 'session/event'); listener = handler } })
  const session = {}

  listener(session, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'draft' }] } } })
  listener(session, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'final' }] } } })
  listener(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  listener(session, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: 'partial' }] } } })
  listener(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(spoken, ['final'])
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
