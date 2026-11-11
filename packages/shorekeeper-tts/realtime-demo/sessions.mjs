import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SESSIONS = path.join(os.homedir(), '.dsh', 'sessions')
const DSH = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const children = new Map()
const announced = new Set()
let sessionHook = ''

export function setSessionHook(url) {
  const next = String(url ?? '').trim()
  if (!next) {
    sessionHook = ''
    return ''
  }
  try {
    const parsed = new URL(next)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') return sessionHook
    sessionHook = parsed.href
  } catch {
    // A bad hook URL is ignored. Creating the session still returns its own text.
  }
  return sessionHook
}

export async function publishNewSession(id, cwd) {
  if (!sessionHook || !ID_PATTERN.test(id) || announced.has(id)) return false
  announced.add(id)
  try {
    const response = await fetch(sessionHook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, cwd }),
    })
    if (!response.ok) announced.delete(id)
    return response.ok
  } catch {
    announced.delete(id)
    return false
  }
}

setSessionHook(process.env.SHOREKEEPER_SESSION_HOOK || '')

function clip(text, limit = 180) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit)}…`
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => part && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

async function readEvents(file) {
  const { stdout } = await execFileAsync('zstd', ['-dc', '--', file], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'buffer',
  })
  const events = []
  for (const line of stdout.toString('utf8').split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A torn final line is ignored. The rest of the log still stands.
    }
  }
  return events
}

function summarize(events, file, mtimeMs) {
  const header = events.find(event => event.type === 'session')
  let title = ''
  let running = false
  const turns = []
  for (const event of events) {
    if (event.type === 'session/title' && typeof event.data?.title === 'string') title = event.data.title
    if (event.type === 'turn/start') running = true
    if (event.type === 'turn/end') running = false
    if (event.type === 'user/message') {
      const text = clip(textOf(event.data?.content))
      if (text) turns.push({ role: 'user', text })
    }
    if (event.type === 'assistant/message') {
      const text = clip(textOf(event.data?.message?.content))
      if (text) turns.push({ role: 'assistant', text })
    }
  }
  const id = header?.id || path.basename(path.dirname(file))
  return {
    id,
    title: clip(title, 40),
    cwd: typeof header?.cwd === 'string' ? header.cwd : '',
    running,
    updatedAt: mtimeMs,
    turns,
  }
}

async function eachSession(onFile) {
  const found = []
  let workspaces = []
  try {
    workspaces = await fs.readdir(SESSIONS)
  } catch {
    return found
  }
  for (const workspace of workspaces) {
    const dir = path.join(SESSIONS, workspace)
    let entries = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('session-')) continue
      const file = path.join(dir, entry, 'session.v4.jsonl.zstd')
      try {
        const stat = await fs.stat(file)
        const item = await onFile(file, stat.mtimeMs)
        if (item) found.push(item)
      } catch {
        // A session without a readable log is skipped.
      }
    }
  }
  found.sort((left, right) => right.updatedAt - left.updatedAt)
  return found
}

export async function listSessions() {
  const items = await eachSession(async (file, mtimeMs) => {
    const events = await readEvents(file)
    const summary = summarize(events, file, mtimeMs)
    return { ...summary, turns: undefined }
  })
  return items
}

export async function describeSessions() {
  const items = await listSessions()
  if (items.length === 0) return '没有会话。'
  return items.slice(0, 12).map(item => {
    const state = item.running ? '正在跑' : '空闲'
    const title = item.title || '无标题'
    const where = item.cwd ? `｜${item.cwd}` : ''
    return `${item.id}｜${state}｜${title}${where}`
  }).join('\n')
}

async function findSession(query) {
  const wanted = String(query ?? '').trim()
  if (!wanted) return { error: '要先说明是哪一个会话。' }
  const items = await eachSession(async (file, mtimeMs) => {
    const id = path.basename(path.dirname(file))
    if (id !== wanted && !id.endsWith(wanted)) return null
    const events = await readEvents(file)
    return summarize(events, file, mtimeMs)
  })
  const matches = items.filter(Boolean)
  if (matches.length === 1) return { session: matches[0] }
  if (matches.length === 0) return { error: '没有这个会话。' }
  return { error: '有多个会话对得上，要把完整 id 说清楚。' }
}

export async function describeSession(query) {
  const found = await findSession(query)
  if (found.error) return found.error
  const session = found.session
  const state = session.running ? '正在跑' : '空闲'
  const lines = [`${session.id}｜${state}｜${session.title || '无标题'}`]
  for (const turn of session.turns.slice(-6)) {
    lines.push(`${turn.role === 'user' ? '漂泊者' : '会话'}：${turn.text}`)
  }
  if (session.turns.length === 0) lines.push('还没有对话。')
  return lines.join('\n')
}

export async function createSession(directory, text) {
  const task = quoteTask(text)
  if (!task) return '没有要交代的话。'
  if (task.length > 2000) return '这句话太长了，缩短后再交给它。'
  const found = await resolveDirectory(directory)
  if (found.error) return found.error
  return handoffNew(found.cwd, task)
}

async function resolveDirectory(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { error: '要说明在哪个目录里新开。' }
  if (raw.startsWith('/') && await existsDir(raw)) return { cwd: raw }
  const items = await listSessions()
  const dirs = [...new Set(items.map(item => item.cwd).filter(cwd => cwd && (path.basename(cwd) === raw || cwd.endsWith(`/${raw}`))))]
  if (dirs.length === 1) return { cwd: dirs[0] }
  if (dirs.length === 0) return { error: '没有找到这个项目的目录。' }
  return { error: '有多个目录对得上，要把完整路径说清楚。' }
}

function existsDir(dir) {
  return fs.stat(dir).then(stat => stat.isDirectory()).catch(() => false)
}

function handoffNew(cwd, task) {
  return handoff(null, task, cwd)
}

function quoteTask(text) {
  const task = String(text ?? '').trim()
  if (!task) return ''
  return task.startsWith('-') ? `请处理：${task}` : task
}

async function waitUntilIdle(sessionId, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const found = await findSession(sessionId)
    if (found.error) return found
    if (!found.session.running) return found
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return { error: '它还在跑，这一轮还没结束，稍后再交代。' }
}

export async function sendToSession(query, text) {
  const task = quoteTask(text)
  if (!task) return '没有要交代的话。'
  if (task.length > 2000) return '这句话太长了，缩短后再交给它。'
  let found = await findSession(query)
  if (found.error) return found.error
  if (found.session.running) {
    found = await waitUntilIdle(found.session.id)
    if (found.error) return found.error
  }
  return handoff(found.session.id, task, found.session.cwd || undefined)
}

export async function steerSession(query, text) {
  const found = await findSession(query)
  if (found.error) return found.error
  if (!found.session.running) return sendToSession(found.session.id, text)
  return '这一轮还在桌面里跑。我从外面插不进正在进行的回合，只能等它结束再交代下一句。'
}

export async function cancelSession(query) {
  const found = await findSession(query)
  if (found.error) return found.error
  const child = children.get(found.session.id)
  if (child && child.exitCode == null && !child.killed) {
    child.kill('SIGTERM')
    children.delete(found.session.id)
    return '已经停下我交给它的那一轮。'
  }
  if (found.session.running) return '这个回合在桌面里跑，我从外面停不掉。'
  return '它现在没在跑。'
}

async function newestSessionIn(cwd) {
  const items = await listSessions()
  return items.find(item => item.cwd === cwd) || null
}

function explainHandoffError(errorText, id) {
  const text = String(errorText || '')
  if (/不能直接投递|一键运行器|preset|runner/i.test(text)) {
    return '没发出去。那个会话不能从外面直接投递，请用 create_session 在目录里新开，或等桌面会话空闲后再试。'
  }
  if (/MISSING_CREDENTIAL|API key/i.test(text)) {
    return '没发出去。headless 缺少 DEEPSEEK_API_KEY，请写在 ~/.dsh/.env。'
  }
  return clip(text, 240) || (id ? `没有交出去。` : `没有新开。`)
}

function watchNewSession(cwd, since) {
  let stopped = false
  const stop = () => { stopped = true }
  const run = async () => {
    while (!stopped) {
      try {
        const created = await newestSessionIn(cwd)
        if (created && created.updatedAt >= since - 1000 && ID_PATTERN.test(created.id)) {
          await publishNewSession(created.id, created.cwd || cwd)
          return
        }
      } catch {
        // The log can still be appearing. The next pass looks again.
      }
      await new Promise(resolve => setTimeout(resolve, 400))
    }
  }
  void run()
  return stop
}

function handoff(id, task, cwd = os.homedir()) {
  if (id && !ID_PATTERN.test(id)) return Promise.resolve('会话 id 不合规，没有交给它。')
  const workdir = cwd && cwd.trim() ? cwd : os.homedir()
  const args = ['--profile', 'headless', '--approval-policy', 'never']
  if (id) args.push('--session-id', id)
  args.push(task)
  return new Promise(resolve => {
    const key = id || workdir
    const before = Date.now()
    const stopWatch = id ? () => {} : watchNewSession(workdir, before)
    const child = spawn(DSH, args, {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, DSH_HOME: process.env.DSH_HOME || path.join(os.homedir(), '.dsh') },
    })
    children.set(key, child)
    let errorText = ''
    child.stdout.on('data', () => {})
    child.stderr.on('data', chunk => {
      errorText += chunk.toString()
      if (errorText.length > 2000) errorText = errorText.slice(-2000)
    })
    let settled = false
    const finish = (text) => {
      if (settled) return
      settled = true
      resolve(text)
    }
    child.once('error', error => {
      stopWatch()
      children.delete(key)
      finish(id ? `没有交出去。${error.message}` : `没有新开。${error.message}`)
    })
    child.once('exit', code => {
      children.delete(key)
      void (async () => {
        stopWatch()
        let created = null
        if (!id) {
          created = await newestSessionIn(workdir)
          if (created && created.updatedAt >= before - 1000) {
            await publishNewSession(created.id, created.cwd || workdir)
          } else {
            created = null
          }
        }
        if (code !== 0) {
          finish(explainHandoffError(errorText, id))
          return
        }
        if (id) {
          finish(`已经投递到 ${id}，这一句做完了。`)
          return
        }
        if (created) {
          finish(`已在 ${workdir} 新开 ${created.id}，首句做完了。后续空闲时用这个 id 调用 send_message。`)
          return
        }
        finish(`已在 ${workdir} 新开对话，首句做完了。`)
      })()
    })
  })
}
