import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

const TTS_ENDPOINT = 'https://api.inworld.ai/tts/v1/voice:stream'
const VOICE_ID = 'sunny-fern-4510__shorekeeper-pro'
const FENCE_READY = /^ {0,3}(`{3,}|~{3,})/
const FENCE_PARTIAL = /^ {0,3}(`{0,2}|~{0,2})$/

let audioSerial = 0

const RATE_MIN = 0.8
const RATE_MAX = 1.5
const RATE_STEP = 0.1

const SPOKEN_MIN = 20
const SPOKEN_MAX = 50
const SPOKEN_STEP = 5
const SPOKEN_DEFAULT = 30

const VOLUME_MIN = 0
const VOLUME_MAX = 1
const VOLUME_STEP = 0.1

const GATE_MIN = 0
const GATE_MAX = 0.08
const GATE_STEP = 0.001
const GATE_DEFAULT = 0.012
const PET_PORT = 18766

export const Config = Schema.object({
  speakingRate: Schema.number().min(RATE_MIN).max(RATE_MAX).step(RATE_STEP).default(1).volatile(),
  minSpoken: Schema.number().min(SPOKEN_MIN).max(SPOKEN_MAX).step(SPOKEN_STEP).default(SPOKEN_DEFAULT).volatile(),
  volume: Schema.number().min(VOLUME_MIN).max(VOLUME_MAX).step(VOLUME_STEP).default(1).volatile(),
  enabled: Schema.boolean().default(true).volatile(),
  inputGate: Schema.number().min(GATE_MIN).max(GATE_MAX).step(GATE_STEP).default(GATE_DEFAULT).volatile(),
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

export function snapMinSpoken(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return SPOKEN_DEFAULT
  const steps = Math.round((number - SPOKEN_MIN) / SPOKEN_STEP)
  const snapped = SPOKEN_MIN + steps * SPOKEN_STEP
  if (snapped < SPOKEN_MIN) return SPOKEN_MIN
  if (snapped > SPOKEN_MAX) return SPOKEN_MAX
  return snapped
}

export function speakingRateOf(config) {
  const read = config?.speakingRate?.get
  if (typeof read !== 'function') return 1
  return snapSpeakingRate(read.call(config.speakingRate))
}

export function minSpokenOf(config) {
  const read = config?.minSpoken?.get
  if (typeof read !== 'function') return SPOKEN_DEFAULT
  return snapMinSpoken(read.call(config.minSpoken))
}

export function speechEnabledOf(config) {
  const read = config?.enabled?.get
  if (typeof read !== 'function') return true
  return read.call(config.enabled) !== false
}

export function snapVolume(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 1
  const steps = Math.round((number - VOLUME_MIN) / VOLUME_STEP)
  const snapped = Math.round((VOLUME_MIN + steps * VOLUME_STEP) * 10) / 10
  if (snapped < VOLUME_MIN) return VOLUME_MIN
  if (snapped > VOLUME_MAX) return VOLUME_MAX
  return snapped
}

export function volumeOf(config) {
  const read = config?.volume?.get
  if (typeof read !== 'function') return 1
  return snapVolume(read.call(config.volume))
}

export function snapInputGate(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return GATE_DEFAULT
  const steps = Math.round((number - GATE_MIN) / GATE_STEP)
  const snapped = Math.round((GATE_MIN + steps * GATE_STEP) * 1000) / 1000
  if (snapped < GATE_MIN) return GATE_MIN
  if (snapped > GATE_MAX) return GATE_MAX
  return snapped
}

export function inputGateOf(config) {
  const read = config?.inputGate?.get
  if (typeof read !== 'function') return GATE_DEFAULT
  return snapInputGate(read.call(config.inputGate))
}

export function afplayArgs(audioPath, volume) {
  return ['-v', snapVolume(volume).toFixed(1), audioPath]
}

export function visibleText(content) {
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/** Join visible text of one finalized assistant message from a session event log. */
export function assistantMessageTextFromEvents(events, messageId) {
  for (const event of events ?? []) {
    if (event?.type !== 'assistant/message') continue
    const message = event.data?.message
    if (!message || typeof message !== 'object' || message.id !== messageId) continue
    const text = visibleText(Array.isArray(message.content) ? message.content : []).trim()
    return text === '' ? null : { messageId, text }
  }
  return null
}

export function sentencesForReplay(text, minSpoken = SPOKEN_DEFAULT) {
  const buffer = createSpeechBuffer({ minSpoken })
  return [...buffer.push(String(text ?? '')), ...buffer.finish()]
}

export function spokenLength(text) {
  return text.replace(/\s/g, '').length
}

function fenceMark(line) {
  const match = FENCE_READY.exec(line)
  return match ? match[1][0] : ''
}

export function createSpeechBuffer(options = {}) {
  const resolveMinSpoken = typeof options.minSpoken === 'function'
    ? options.minSpoken
    : () => snapMinSpoken(options.minSpoken ?? SPOKEN_DEFAULT)
  let pendingLine = ''
  let atLineStart = true
  let inFence = false
  let fenceChar = ''
  let speak = ''

  function takeSentences(force) {
    const ready = []
    const minSpoken = resolveMinSpoken()
    while (speak.length > 0) {
      let cut = -1
      for (let index = 0; index < speak.length; index += 1) {
        const char = speak[index]
        if (char !== '。' && char !== '\n') continue
        if (spokenLength(speak.slice(0, index + 1)) > minSpoken) {
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
      synthesis_context: { reasoning: 'REASONING_ON' },
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
      const launch = controls.spawn ?? spawn
      const afplay = existsSync('/usr/bin/afplay') ? '/usr/bin/afplay' : 'afplay'
      const player = launch(afplay, afplayArgs(audioPath, controls.volume), { stdio: 'ignore' })
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

function createSpeaker({ synthesizeAudio, playAudio, getApiKey, volumeOfPlayback = () => 1 }) {
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
        volume: volumeOfPlayback(),
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

const SPEAK_CHANNEL = '/shorekeeper-tts'
const PET_APP_MARK = 'MacOS/ShorekeeperPet'

let petStartedByPlugin = false
let closingPet = false

function petStatePath() {
  return join(homedir(), '.dsh', 'shorekeeper-pet-open')
}

function writePetWanted(wanted) {
  try {
    writeFileSync(petStatePath(), wanted ? '1' : '0')
  } catch {
    // A missing home directory should not take the voice plugin down.
  }
}

function petWanted() {
  try {
    return readFileSync(petStatePath(), 'utf8').trim() === '1'
  } catch {
    return false
  }
}

export function petRoot() {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'realtime-demo')
  return existsSync(join(root, 'server.mjs')) ? root : null
}

function petAppPaths(root = petRoot()) {
  if (!root) return null
  const app = join(root, 'mac', 'ShorekeeperPet.app')
  return {
    root,
    app,
    bin: join(app, 'Contents', 'MacOS', 'ShorekeeperPet'),
    plist: join(root, 'mac', 'Info.plist'),
    source: join(root, 'mac', 'main.swift'),
  }
}

function ensurePetDependencies(root) {
  if (existsSync(join(root, 'node_modules', 'ws'))) return { ok: true }
  const install = spawnSync('npm', ['install', '--omit=dev', '--registry', 'https://registry.npmjs.org'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
    },
  })
  if (install.status !== 0) {
    const detail = String(install.stderr || install.stdout || '').trim()
    return {
      ok: false,
      error: {
        code: 'failed',
        message: detail ? `桌宠依赖安装失败：${detail}` : '桌宠依赖安装失败。',
      },
    }
  }
  return { ok: true }
}

function ensurePetApp(root) {
  const paths = petAppPaths(root)
  if (!paths) return { ok: false, error: { code: 'not-found', message: '找不到桌宠。' } }
  if (!existsSync(paths.source) || !existsSync(paths.plist)) {
    return { ok: false, error: { code: 'not-found', message: '桌宠源码不完整。' } }
  }

  const deps = ensurePetDependencies(root)
  if (!deps.ok) return deps

  mkdirSync(dirname(paths.bin), { recursive: true })
  copyFileSync(paths.plist, join(paths.app, 'Contents', 'Info.plist'))

  const binaryTime = existsSync(paths.bin) ? statSync(paths.bin).mtimeMs : 0
  if (statSync(paths.source).mtimeMs <= binaryTime) return { ok: true, value: paths }

  if (process.platform !== 'darwin') {
    return { ok: false, error: { code: 'unsupported', message: '桌宠窗口目前只支持 macOS。' } }
  }

  const compiled = spawnSync('swiftc', [
    '-O', '-o', paths.bin, paths.source,
    '-framework', 'Cocoa',
    '-framework', 'WebKit',
    '-framework', 'AVFoundation',
    '-framework', 'AudioToolbox',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
    },
  })
  if (compiled.status !== 0) {
    const detail = String(compiled.stderr || compiled.stdout || '').trim()
    return {
      ok: false,
      error: {
        code: 'failed',
        message: detail ? `桌宠编译失败：${detail}` : '桌宠编译失败。需要本机有 Xcode/Command Line Tools。',
      },
    }
  }
  spawnSync('codesign', [
    '--force', '--sign', '-', '--identifier', 'local.shorekeeper.pet', paths.app,
  ], { encoding: 'utf8' })
  return { ok: true, value: paths }
}

function nodeBinary() {
  if (existsSync('/opt/homebrew/bin/node')) return '/opt/homebrew/bin/node'
  if (existsSync('/usr/local/bin/node')) return '/usr/local/bin/node'
  return process.execPath
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function pidsMatching(args) {
  const result = spawnSync('pgrep', args, { encoding: 'utf8' })
  if (result.status !== 0) return []
  return String(result.stdout).split(/\s+/).map(item => Number(item)).filter(pid => pid > 0)
}

function signalPids(pids) {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }
}

function petWindowPids() {
  return pidsMatching(['-f', PET_APP_MARK])
}

function listenerPids() {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${PET_PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return String(result.stdout).split(/\s+/).map(item => Number(item)).filter(pid => pid > 0)
}

export async function pushInputGate(value) {
  try {
    await fetch(`http://127.0.0.1:${PET_PORT}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: snapInputGate(value) }),
    })
  } catch {
    // The pet server is optional until the switch is on.
  }
}

export async function petLevel() {
  try {
    const response = await fetch(`http://127.0.0.1:${PET_PORT}/level`)
    if (!response.ok) return 0
    const body = await response.json()
    const level = Number(body?.value)
    return Number.isFinite(level) ? level : 0
  } catch {
    return 0
  }
}

async function ensurePetServer(root) {
  if (await portOpen(PET_PORT)) return true
  const logPath = join(homedir(), '.dsh', 'shorekeeper-voice.log')
  let logFd = 'ignore'
  try { logFd = openSync(logPath, 'a') } catch { logFd = 'ignore' }
  const env = {
    ...process.env,
    PORT: String(PET_PORT),
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(nodeBinary(), ['server.mjs'], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (await portOpen(PET_PORT)) return true
  }
  return false
}

function rpcResult(result) {
  if (result && typeof result === 'object' && result.ok === false) {
    const error = result.error && typeof result.error === 'object' ? result.error : {}
    return {
      ok: false,
      error: {
        code: typeof error.code === 'string' ? error.code : 'failed',
        message: typeof error.message === 'string' ? error.message : '失败',
        details: error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {},
      },
    }
  }
  if (result && typeof result === 'object' && result.ok === true) return result
  return { ok: true, value: result }
}

export async function startPet(gate = GATE_DEFAULT) {
  closingPet = false
  const prepared = ensurePetApp(petRoot())
  if (!prepared.ok) return prepared
  const { root, app } = prepared.value
  const up = await ensurePetServer(root)
  if (!up) return { ok: false, error: { code: 'unavailable', message: '语音服务没有起来。' } }
  if (petWindowPids().length === 0) {
    const opener = existsSync('/usr/bin/open') ? '/usr/bin/open' : 'open'
    const opened = spawnSync(opener, ['-n', '--env', `PET_PORT=${PET_PORT}`, app], { encoding: 'utf8' })
    if (opened.status !== 0) {
      return { ok: false, error: { code: 'failed', message: '桌宠没有打开。' } }
    }
  }
  writePetWanted(true)
  petStartedByPlugin = true
  await pushInputGate(gate)
  return { ok: true, value: { enabled: true } }
}

export async function stopPet() {
  closingPet = true
  writePetWanted(false)
  signalPids(petWindowPids())
  signalPids(listenerPids())
  return { ok: true, value: { enabled: false } }
}

export function closePetWithHost() {
  if (!petStartedByPlugin || closingPet) return
  closingPet = true
  const alive = petWindowPids().length > 0
  writePetWanted(alive)
  signalPids(petWindowPids())
  signalPids(listenerPids())
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
    const buffer = createSpeechBuffer({
      minSpoken: () => minSpokenOf(config),
    })
    const run = synthesizeAudio ?? synthesize
    const speaker = createSpeaker({
      synthesizeAudio: (text, key) => run(text, key, fetch, {
        speakingRate: speakingRateOf(config),
      }),
      playAudio,
      getApiKey,
      volumeOfPlayback: () => volumeOf(config),
    })

    const enqueueAll = (sentences, { force = false } = {}) => {
      if (!force && !speechEnabledOf(config)) return
      for (const sentence of sentences) speaker.enqueue(sentence)
    }

    const stop = () => {
      speaker.stop()
      buffer.clear()
    }

    const speakFull = text => {
      const trimmed = String(text ?? '').trim()
      if (!trimmed) return { ok: false, error: { message: '没有可朗读的正文。' } }
      stop()
      const sentences = sentencesForReplay(trimmed, minSpokenOf(config))
      if (sentences.length === 0) return { ok: false, error: { message: '没有可朗读的正文。' } }
      enqueueAll(sentences, { force: true })
      return { ok: true, value: { sentences: sentences.length } }
    }

    const lookupAssistantText = (sessionId, messageId) => {
      if (typeof messageId !== 'string' || messageId.trim() === '') return null
      const agents = ctx.agents ?? ctx.get?.('agents')
      if (!agents) return null
      const direct = typeof sessionId === 'string' && sessionId.trim() !== ''
        ? agents.get?.(sessionId.trim())
        : undefined
      const candidates = direct
        ? [direct]
        : (typeof agents.values === 'function' ? [...agents.values()] : [])
      for (const agent of candidates) {
        const events = agent?.session?.snapshotEvents?.()
        const found = assistantMessageTextFromEvents(events, messageId)
        if (found) return found
      }
      return null
    }

    const publishGate = () => { void pushInputGate(inputGateOf(config)) }
    ctx.on?.('loader/volatile-update', () => {
      if (!speechEnabledOf(config)) stop()
      publishGate()
    })
    publishGate()

    ctx.on('agent/assistant-stream', (payload, second) => {
      const frame = frameOf(payload, second)
      if (!frame || typeof frame !== 'object') return
      if (!speechEnabledOf(config)) {
        buffer.clear()
        return
      }
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
    let disposeRpc = () => {}
    // Dedicated RPC channels must register on a context that also has webServer,
    // otherwise connection.rpc.handle cannot mount the HTTP prefix (mnemon does
    // the same inject pair). Without this, the browser gets 404 and the button
    // looks like a no-op.
    if (typeof ctx.inject === 'function') {
      ctx.inject(['connection', 'webServer'], scope => {
        try {
          const host = typeof scope.extend === 'function'
            ? scope.extend({ webServer: scope.webServer ?? scope.get?.('webServer') })
            : scope
          const connection = host.connection ?? scope.connection
          if (!connection?.rpc?.handle) {
            console.error('[dsh-shorekeeper-tts] connection.rpc.handle is unavailable')
            return
          }
          const remove = connection.rpc.handle(SPEAK_CHANNEL, async (endpoint, payload) => {
            if (endpoint === 'pet') {
              if (payload?.enabled === true) return rpcResult(await startPet(inputGateOf(config)))
              if (payload?.enabled === false) return rpcResult(stopPet())
              return rpcResult({ ok: true, value: { enabled: petWindowPids().length > 0, level: await petLevel() } })
            }
            if (endpoint !== 'speak') {
              return rpcResult({ ok: false, error: { code: 'unknown', message: `unknown endpoint: ${String(endpoint)}` } })
            }
            const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
            const messageId = typeof payload?.messageId === 'string' ? payload.messageId : ''
            const directText = typeof payload?.text === 'string' ? payload.text.trim() : ''
            if (directText) return rpcResult(speakFull(directText))
            const found = lookupAssistantText(sessionId, messageId)
            if (!found) {
              console.error(`[dsh-shorekeeper-tts] message text not found session=${sessionId} message=${messageId}`)
              return rpcResult({ ok: false, error: { code: 'not-found', message: '无法从会话记录提取这条消息的文本。' } })
            }
            return rpcResult(speakFull(found.text))
          })
          disposeRpc = typeof remove === 'function' ? remove : () => {}
          scope.on?.('dispose', () => {
            disposeRpc()
          })
        } catch (error) {
          console.error(`[dsh-shorekeeper-tts] failed to register speak RPC: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      if (petWanted()) void startPet(inputGateOf(config))
      process.once('exit', closePetWithHost)
    }

    ctx.on?.('dispose', () => {
      closePetWithHost()
      disposeHotkey()
      disposeRpc()
      if (typeof disposeCommand === 'function') disposeCommand()
    })

    onReady?.({ stop, whenIdle: speaker.whenIdle, shush: stop, speakFull })
  }
}

export const name = '@dsh-local/shorekeeper-tts'
export const inject = ['commands']
export const apply = createShorekeeperTtsPlugin()
