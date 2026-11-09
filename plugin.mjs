import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TTS_ENDPOINT = 'https://api.inworld.ai/tts/v1/voice:stream'
const VOICE_ID = 'sunny-fern-4510__shorekeeper-pro'

export function visibleText(content) {
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

export async function synthesize(text, apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('INWORLD_API_KEY is not configured.')

  const response = await fetchImpl(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: VOICE_ID,
      model_id: 'inworld-tts-2',
      audio_config: { audio_encoding: 'MP3', speaking_rate: 1 },
      delivery_mode: 'BALANCED',
      language: 'AUTO',
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000)
    throw new Error(`Inworld TTS request failed with HTTP ${response.status}: ${detail}`)
  }

  const chunks = []
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.trim()) continue
    const item = JSON.parse(line)
    const audioContent = item?.result?.audioContent ?? item?.audioContent
    if (typeof audioContent === 'string') chunks.push(Buffer.from(audioContent, 'base64'))
  }
  if (chunks.length === 0) throw new Error('Inworld TTS response contained no audio.')
  return Buffer.concat(chunks)
}

export async function playMp3(audio) {
  const audioPath = join(tmpdir(), 'dsh-shorekeeper-tts.mp3')
  await writeFile(audioPath, audio)

  await new Promise((resolve, reject) => {
    const player = spawn('afplay', [audioPath], { stdio: 'ignore' })
    player.once('error', reject)
    player.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`afplay exited with code ${String(code)}.`))
    })
  })
}

export function createShorekeeperTtsPlugin({
  getApiKey = () => process.env.INWORLD_API_KEY,
  synthesizeAudio = synthesize,
  playAudio = playMp3,
} = {}) {
  return function apply(ctx) {
    const finalMessages = new WeakMap()
    let queue = Promise.resolve()

    ctx.on('session/event', (session, event) => {
      if (event.type === 'assistant/message') {
        let turns = finalMessages.get(session)
        if (!turns) {
          turns = new Map()
          finalMessages.set(session, turns)
        }
        turns.set(event.data.turn, visibleText(event.data.message.content))
        return
      }

      if (event.type !== 'turn/end') return

      const turns = finalMessages.get(session)
      const text = turns?.get(event.data.turn)
      turns?.delete(event.data.turn)
      if (event.data.reason.kind !== 'completed' || !text?.trim()) return

      queue = queue
        .then(async () => {
          const audio = await synthesizeAudio(text, getApiKey())
          await playAudio(audio)
        })
        .catch(error => {
          console.error(`[dsh-shorekeeper-tts] ${error instanceof Error ? error.message : String(error)}`)
        })
    })
  }
}

export const name = 'dsh-shorekeeper-tts'
export const apply = createShorekeeperTtsPlugin()
