import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { cancelSession, createSession, describeSession, describeSessions, sendToSession, steerSession } from './sessions.mjs'

const VOICE = 'sunny-fern-4510__shorekeeper-pro'
const MODEL = 'inworld/models/deepseek-v4.1-flash'
const PORT = Number(process.env.PORT || 18765)
const ROOT = dirname(fileURLToPath(import.meta.url))
const INSTRUCTIONS = [
  '你是守岸人。漂泊者在跟你说话。',
  '用很短的中文，每次一两句，必须有句号。',
  '不要分条，不要说自己是模型。',
  '和本机会话有关的问题，先调用工具，再根据工具结果回答。不要念工具原文。',
  '要在某个项目里新开对话，调用 create_session，传入目录名和要做的事。不要把新任务塞进已有会话。',
  'send_message 只能继续一个已有会话。桌面里开着的会话常常拒绝一次性投递。',
].join('')

const TOOLS = [
  {
    type: 'function',
    name: 'list_sessions',
    description: '列出本机 DeepSeek Harness 会话，包含 id、是否在跑、标题和目录。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'read_session',
    description: '阅读一个会话最近的几句对话。session_id 必须来自 list_sessions。',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_session',
    description: '在指定项目目录里新开一个对话并开始做这件事。directory 用目录名或绝对路径，例如 shift。不要用它去继续已有会话。',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['directory', 'text'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'send_message',
    description: '把一句交代交给一个已有的空闲会话执行。不能用来新建对话。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['session_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'steer',
    description: '在会话正在跑时改口。如果插不进去，把原因告诉漂泊者。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['session_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cancel',
    description: '取消一个正在跑的会话回合。',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
      additionalProperties: false,
    },
  },
]

function loadKey() {
  const fromEnv = process.env.INWORLD_API_KEY
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  try {
    const text = readFileSync(join(homedir(), '.dsh', '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?INWORLD_API_KEY\s*=\s*(.*)\s*$/)
      if (!match) continue
      const value = match[1].trim().replace(/^['"]|['"]$/g, '')
      if (value) return value
    }
  } catch {
    // The key stays on the machine.
  }
  throw new Error('INWORLD_API_KEY is missing')
}

function sessionUpdate({ instructions = INSTRUCTIONS, tools = TOOLS } = {}) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: MODEL,
      instructions,
      tools,
      tool_choice: 'auto',
      output_modalities: ['audio', 'text'],
      audio: {
        input: {
          transcription: { model: 'inworld/inworld-stt-1' },
          turn_detection: {
            type: 'semantic_vad',
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: VOICE,
          model: 'inworld-tts-2',
          format: { type: 'audio/pcm', rate: 24000 },
        },
      },
    },
  }
}

function connectInworld() {
  return new WebSocket('wss://api.inworld.ai/api/v1/realtime/session?protocol=realtime', {
    headers: { Authorization: `Basic ${loadKey()}` },
  })
}

function argsOf(message) {
  const raw = message.arguments ?? message.item?.arguments ?? '{}'
  if (typeof raw !== 'string') return raw && typeof raw === 'object' ? raw : {}
  try { return JSON.parse(raw) } catch { return {} }
}

function callOf(message) {
  const name = message.name || message.item?.name
  const callId = message.call_id || message.item?.call_id || message.item?.id
  if (!name || !callId) return null
  return { name, callId, args: argsOf(message) }
}

async function runTool(name, args) {
  const sessionId = typeof args.session_id === 'string' ? args.session_id : ''
  if (name === 'list_sessions') return describeSessions()
  if (name === 'read_session') return describeSession(sessionId)
  if (name === 'create_session') return createSession(args.directory, args.text)
  if (name === 'send_message') return sendToSession(sessionId, args.text)
  if (name === 'steer') return steerSession(sessionId, args.text)
  if (name === 'cancel') return cancelSession(sessionId)
  if (name === 'ping') return 'pong'
  return '没有这个工具。'
}

function answerTool(api, callId, output) {
  api.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: callId, output: String(output) },
  }))
  api.send(JSON.stringify({ type: 'response.create' }))
}

function publicEvent(message) {
  const type = message.type || ''
  if (type === 'error') {
    return { type: 'error', message: message.error?.message || message.message || '会话出错' }
  }
  if (type === 'input_audio_buffer.speech_started') return { type: 'interrupt' }
  if (type === 'input_audio_buffer.speech_stopped') return { type: 'listen-end' }
  if (type === 'response.created') return { type: 'response-started' }
  if (type === 'conversation.item.input_audio_transcription.completed') {
    return { type: 'caption', role: 'you', text: message.transcript || '' }
  }
  if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
    return { type: 'caption', role: 'her', text: message.transcript || '' }
  }
  if (type === 'response.output_audio.delta' && typeof message.delta === 'string') {
    return { type: 'audio', pcm: message.delta }
  }
  if (type === 'response.done') return { type: 'response-done' }
  return null
}

function isToolEvent(message) {
  const type = message.type || ''
  if (type === 'response.function_call_arguments.done') return true
  if (type === 'response.output_item.done' && message.item?.type === 'function_call') return true
  return false
}

function attachTools(api, onTool) {
  const answered = new Set()
  api.on('message', async raw => {
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    if (!isToolEvent(message)) return
    const call = callOf(message)
    if (!call || answered.has(call.callId)) return
    answered.add(call.callId)
    onTool?.(call.name)
    try {
      const output = await runTool(call.name, call.args)
      if (api.readyState === WebSocket.OPEN) answerTool(api, call.callId, output)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (api.readyState === WebSocket.OPEN) answerTool(api, call.callId, text)
    }
  })
}

function ffmpegBin() {
  for (const candidate of [process.env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

let speaker = null

function stopSpeaker() {
  const current = speaker
  speaker = null
  if (!current) return
  current.stdin?.destroy()
  current.kill('SIGKILL')
}

function openSpeaker(rate) {
  const ffmpeg = ffmpegBin()
  if (!ffmpeg) return null
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-f', 's16le', '-ar', String(rate), '-ac', '1',
    '-i', 'pipe:0',
    '-f', 'audiotoolbox', '-audio_device_index', '0',
    '-y', '/dev/null',
  ], { stdio: ['pipe', 'ignore', 'pipe'] })
  child.rate = rate
  child.stdin.on('error', () => {
    if (speaker === child) speaker = null
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString().trim()
    if (text) console.error(`[speaker] ${text}`)
  })
  child.on('exit', () => {
    if (speaker === child) speaker = null
  })
  return child
}

function playSpeaker(base64, rate) {
  const audio = Buffer.from(base64, 'base64')
  if (audio.length === 0) return
  if (!speaker || speaker.exitCode != null || speaker.rate !== rate || !speaker.stdin?.writable) {
    stopSpeaker()
    speaker = openSpeaker(rate)
  }
  if (!speaker?.stdin?.writable) return
  speaker.stdin.write(audio)
}

let inputGate = 0.012
let inputLevel = 0
let outputRate = 24000
const petBrowsers = new Set()

function applyInputGate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return inputGate
  inputGate = Math.min(0.08, Math.max(0, Math.round(number * 1000) / 1000))
  const event = JSON.stringify({ type: 'gate', value: inputGate })
  for (const browser of petBrowsers) {
    if (browser.readyState === WebSocket.OPEN) browser.send(event)
  }
  return inputGate
}

function probe() {
  const api = connectInworld()
  const timer = setTimeout(() => {
    console.error('timed out')
    api.close()
    process.exit(1)
  }, 15000)
  api.on('open', () => api.send(JSON.stringify(sessionUpdate())))
  api.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'session.updated' || message.type === 'error') {
      console.log(message.type === 'error' ? (message.error?.message || 'session error') : message.type)
      clearTimeout(timer)
      api.close()
      process.exit(message.type === 'error' ? 1 : 0)
    }
  })
  api.on('error', error => {
    console.error(error.message)
    process.exit(1)
  })
}

function probeTools() {
  const api = connectInworld()
  let sawCall = false
  const timer = setTimeout(() => {
    console.error(sawCall ? 'tool returned but no follow-up' : 'timed out before a tool call')
    api.close()
    process.exit(1)
  }, 30000)
  attachTools(api, name => {
    sawCall = name === 'ping'
    console.log(`tool: ${name}`)
  })
  api.on('message', raw => {
    const message = JSON.parse(raw.toString())
    const type = message.type || ''
    if (type === 'session.created') {
      api.send(JSON.stringify(sessionUpdate({
        instructions: '你必须调用 ping 工具，然后用一句中文告诉我结果。',
        tools: [{
          type: 'function',
          name: 'ping',
          description: '返回 pong。',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        }],
      })))
    }
    if (type === 'session.updated') {
      api.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '请调用 ping。' }],
        },
      }))
      api.send(JSON.stringify({ type: 'response.create' }))
    }
    if (type === 'response.output_audio_transcript.done' && sawCall) {
      console.log('follow-up ok')
      clearTimeout(timer)
      api.close()
      process.exit(0)
    }
    if (type === 'error') {
      console.error(message.error?.message || message.message || 'session error')
      clearTimeout(timer)
      api.close()
      process.exit(1)
    }
  })
  api.on('error', error => {
    console.error(error.message)
    process.exit(1)
  })
}

function serve() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(readFileSync(join(ROOT, 'index.html')))
      return
    }
    if (url.pathname === '/pet') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(readFileSync(join(ROOT, 'pet.html')))
      return
    }
    if (url.pathname.startsWith('/sprites/')) {
      const name = basename(url.pathname)
      const file = join(ROOT, 'pet', 'sprites', name)
      if (!file.startsWith(join(ROOT, 'pet', 'sprites'))) {
        response.writeHead(404)
        response.end()
        return
      }
      try {
        const data = readFileSync(file)
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' })
        response.end(data)
      } catch {
        response.writeHead(404)
        response.end()
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/gate') {
      const chunks = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        let value = inputGate
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')).value } catch { /* keep the current gate */ }
        const applied = applyInputGate(value)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ value: applied }))
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/level') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ value: inputLevel }))
      return
    }
    response.writeHead(404)
    response.end()
  })

  const sockets = new WebSocketServer({ server, path: '/ws' })
  sockets.on('connection', browser => {
    let api
    const send = event => {
      if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(event))
    }
    try {
      api = connectInworld()
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : '连不上语音。' })
      return
    }
    api.on('open', () => send({ type: 'status', text: '已连上，正在设置音色' }))
    attachTools(api, name => {
      console.log(`tool: ${name}`)
      send({ type: 'think' })
    })
    api.on('message', raw => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'session.updated') {
        outputRate = message.session?.audio?.output?.format?.rate || outputRate
        send({ type: 'ready', rate: outputRate })
      }
      if (message.type === 'response.output_audio.delta' && typeof message.delta === 'string') {
        playSpeaker(message.delta, outputRate)
      }
      if (message.type === 'session.created') api.send(JSON.stringify(sessionUpdate()))
      const event = publicEvent(message)
      if (event) send(event)
    })
    api.on('close', () => send({ type: 'status', text: '连接已断开' }))
    api.on('error', error => send({ type: 'error', message: error.message }))
    browser.on('message', raw => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.type === 'level') {
        const number = Number(message.value)
        if (Number.isFinite(number)) inputLevel = Math.max(0, number)
        return
      }
      if (message.type === 'cut') {
        stopSpeaker()
        return
      }
      if (api.readyState !== WebSocket.OPEN) return
      if (message.type === 'audio' && typeof message.pcm === 'string') {
        api.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: message.pcm }))
      }
    })
    petBrowsers.add(browser)
    browser.on('close', () => {
      petBrowsers.delete(browser)
      api.close()
    })
    send({ type: 'gate', value: inputGate })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${PORT}/`)
  })
}

if (process.argv.includes('--probe-tools')) probeTools()
else if (process.argv.includes('--probe')) probe()
else serve()
