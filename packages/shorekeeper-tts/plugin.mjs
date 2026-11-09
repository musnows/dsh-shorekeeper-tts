import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

const TTS_ENDPOINT = 'https://api.inworld.ai/tts/v1/voice:stream'
const VOICE_ID = 'sunny-fern-4510__shorekeeper-pro'
const MIN_SPOKEN = 20
const FENCE_READY = /^ {0,3}(`{3,}|~{3,})/
const FENCE_PARTIAL = /^ {0,3}(`{0,2}|~{0,2})$/

let audioSerial = 0

const RATE_MIN = 0.8
const RATE_MAX = 1.5
const RATE_STEP = 0.1

export const Config = Schema.object({
  speakingRate: Schema.number().min(RATE_MIN).max(RATE_MAX).step(RATE_STEP).default(1).volatile(),
})

export function snapSpeakingRate(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 1
  const steps = Math.round((number - RATE_MIN) / RATE_STEP)
  const snapped = Math.round((RATE_MIN + steps * RATE_STEP) * 10) / 10
  if (snapped < RATE_MIN) return RATE_MIN
  if (snapped > RATE_MAX) return RATE_MAX
  return snapped
}

export function speakingRateOf(config) {
  const read = config?.speakingRate?.get
  if (typeof read !== 'function') return 1
  return snapSpeakingRate(read.call(config.speakingRate))
}

export function visibleText(content) {
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

export function spokenLength(text) {
  return text.replace(/\s/g, '').length
}

function fenceMark(line) {
  const match = FENCE_READY.exec(line)
  return match ? match[1][0] : ''
}

export function createSpeechBuffer() {
  let pendingLine = ''
  let atLineStart = true
  let inFence = false
  let fenceChar = ''
  let speak = ''

  function takeSentences(force) {
    const ready = []
    while (speak.length > 0) {
      let cut = -1
      for (let index = 0; index < speak.length; index += 1) {
        const char = speak[index]
        if (char !== '。' && char !== '\n') continue
        if (spokenLength(speak.slice(0, index + 1)) > MIN_SPOKEN) {
          cut = index
          break
        }
      }
      if (cut < 0) {
        if (!force) break
        const tail = speak.trim()
        speak = ''
        if (tail) ready.push(tail)
        break
      }
      const sentence = speak.slice(0, cut + 1).trim()
      speak = speak.slice(cut + 1)
      if (sentence) ready.push(sentence)
    }
    return ready
  }

  function commitLine(line) {
    const mark = fenceMark(line)
    if (inFence) {
      if (mark && mark === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      return
    }
    if (mark) {
      inFence = true
      fenceChar = mark
      return
    }
    speak += `${line}\n`
  }

  function push(delta) {
    const ready = []
    pendingLine += String(delta).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    let newlineAt = pendingLine.indexOf('\n')
    while (newlineAt !== -1) {
      const line = pendingLine.slice(0, newlineAt)
      pendingLine = pendingLine.slice(newlineAt + 1)
      if (atLineStart) commitLine(line)
      else if (!inFence) speak += `${line}\n`
      atLineStart = true
      ready.push(...takeSentences(false))
      newlineAt = pendingLine.indexOf('\n')
    }
    if (!atLineStart) {
      if (!inFence && pendingLine) {
        speak += pendingLine
        pendingLine = ''
        ready.push(...takeSentences(false))
      }
      return ready
    }
    if (!inFence && pendingLine && !FENCE_PARTIAL.test(pendingLine) && !fenceMark(pendingLine)) {
      speak += pendingLine
      pendingLine = ''
      atLineStart = false
      ready.push(...takeSentences(false))
    }
    return ready
  }

  function finish() {
    if (pendingLine && !inFence && (!atLineStart || !fenceMark(pendingLine))) speak += pendingLine
    pendingLine = ''
    atLineStart = true
    inFence = false
    fenceChar = ''
    return takeSentences(true)
  }

  function clear() {
    pendingLine = ''
    atLineStart = true
    inFence = false
    fenceChar = ''
    speak = ''
  }

  return { push, finish, clear }
}

export function parseEnvAssignment(text, name) {
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

export function loadInworldApiKey({
  env = process.env,
  envPath = join(homedir(), '.dsh', '.env'),
  readFile = readFileSync,
} = {}) {
  const fromEnv = env.INWORLD_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    return parseEnvAssignment(readFile(envPath, 'utf8'), 'INWORLD_API_KEY')
  } catch {
    return ''
  }
}

export async function synthesize(text, apiKey, fetchImpl = fetch, options = {}) {
  if (!apiKey) throw new Error('INWORLD_API_KEY is not configured.')
  const speakingRate = snapSpeakingRate(options.speakingRate ?? 1)

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
      audio_config: { audio_encoding: 'MP3', speaking_rate: speakingRate },
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

export async function playMp3(audio, controls = {}) {
  const audioPath = join(tmpdir(), `dsh-shorekeeper-${process.pid}-${audioSerial += 1}.mp3`)
  await writeFile(audioPath, audio)
  try {
    if (controls.isCurrent && !controls.isCurrent()) return
    await new Promise((resolve, reject) => {
      const player = spawn('afplay', [audioPath], { stdio: 'ignore' })
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const kill = () => {
        player.kill('SIGTERM')
        finish()
      }
      controls.bindStop?.(kill)
      if (controls.isCurrent && !controls.isCurrent()) {
        kill()
        return
      }
      player.once('error', error => {
        if (settled) return
        settled = true
        reject(error)
      })
      player.once('exit', code => {
        if (settled) return
        settled = true
        if (code === 0 || code === null || (controls.isCurrent && !controls.isCurrent())) resolve()
        else reject(new Error(`afplay exited with code ${String(code)}.`))
      })
    })
  } finally {
    await unlink(audioPath).catch(() => {})
  }
}

function createSpeaker({ synthesizeAudio, playAudio, getApiKey }) {
  let generation = 0
  let synthTail = Promise.resolve()
  let playTail = Promise.resolve()
  let stopPlayback = null

  function enqueue(text) {
    const gen = generation
    const audioPromise = synthTail.then(async () => {
      if (gen !== generation) return null
      return synthesizeAudio(text, getApiKey())
    }).catch(error => {
      console.error(`[dsh-shorekeeper-tts] ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    synthTail = audioPromise.then(() => {})
    playTail = playTail.then(async () => {
      if (gen !== generation) return
      const audio = await audioPromise
      if (!audio || gen !== generation) return
      await playAudio(audio, {
        isCurrent: () => gen === generation,
        bindStop(stop) {
          if (gen === generation) stopPlayback = stop
        },
      })
    }).catch(error => {
      console.error(`[dsh-shorekeeper-tts] ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  function stop() {
    generation += 1
    const halt = stopPlayback
    stopPlayback = null
    halt?.()
  }

  function whenIdle() {
    return Promise.all([synthTail, playTail]).then(() => {})
  }

  return { enqueue, stop, whenIdle }
}

function startStopHotkey(onStop) {
  if (process.platform !== 'darwin') return () => {}
  let child = null
  let stopped = false
  const binary = join(tmpdir(), 'dsh-shorekeeper-stop-hotkey')
  const source = fileURLToPath(new URL('./stop-hotkey.swift', import.meta.url))

  const launch = () => {
    if (stopped || !existsSync(binary)) return
    child = spawn(binary, { stdio: ['ignore', 'pipe', 'ignore'] })
    child.once('error', () => {})
    if (!child.stdout) return
    child.stdout.setEncoding('utf8')
    let pending = ''
    child.stdout.on('data', chunk => {
      pending += chunk
      let newlineAt = pending.indexOf('\n')
      while (newlineAt !== -1) {
        pending = pending.slice(newlineAt + 1)
        onStop()
        newlineAt = pending.indexOf('\n')
      }
    })
  }

  if (existsSync(binary)) launch()
  else {
    const compile = spawn('swiftc', ['-O', '-framework', 'AppKit', '-o', binary, source], { stdio: 'ignore' })
    compile.once('error', () => {})
    compile.once('exit', code => {
      if (code === 0) launch()
    })
  }

  return () => {
    stopped = true
    child?.kill()
  }
}

function frameOf(payload, second) {
  if (payload?.frame) return payload.frame
  if (second?.type) return second
  return payload
}

export function createShorekeeperTtsPlugin({
  getApiKey = () => loadInworldApiKey(),
  synthesizeAudio,
  playAudio = playMp3,
  hotkey = true,
  startHotkey = startStopHotkey,
  onReady,
} = {}) {
  return function apply(ctx, config) {
    const buffer = createSpeechBuffer()
    const run = synthesizeAudio ?? synthesize
    const speaker = createSpeaker({
      synthesizeAudio: (text, key) => run(text, key, fetch, {
        speakingRate: speakingRateOf(config),
      }),
      playAudio,
      getApiKey,
    })

    const enqueueAll = sentences => {
      for (const sentence of sentences) speaker.enqueue(sentence)
    }

    const stop = () => {
      speaker.stop()
      buffer.clear()
    }

    ctx.on('agent/assistant-stream', (payload, second) => {
      const frame = frameOf(payload, second)
      if (!frame || typeof frame !== 'object') return
      if (frame.type === 'start') {
        buffer.clear()
        return
      }
      if (frame.type === 'end') {
        enqueueAll(buffer.finish())
        return
      }
      if (frame.type !== 'chunk') return
      const chunk = frame.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        enqueueAll(buffer.push(chunk.text))
        return
      }
      if (chunk?.type === 'block-end' && chunk.block?.type === 'text') enqueueAll(buffer.finish())
    })

    const disposeCommand = ctx.commands?.register?.({
      name: 'shush',
      description: '停下守岸人正在说的话，并丢掉还没开口的正文',
      handler() {
        stop()
        return { kind: 'success', text: '已经停下。' }
      },
    })

    const disposeHotkey = hotkey ? startHotkey(stop) : () => {}
    ctx.on?.('dispose', () => {
      disposeHotkey()
      if (typeof disposeCommand === 'function') disposeCommand()
    })

    onReady?.({ stop, whenIdle: speaker.whenIdle, shush: stop })
  }
}

export const name = '@dsh-local/shorekeeper-tts'
export const inject = ['commands']
export const apply = createShorekeeperTtsPlugin()
