import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || '18766'
const APP = path.join(ROOT, 'mac', 'ShorekeeperPet.app')
const BIN = path.join(APP, 'Contents', 'MacOS', 'ShorekeeperPet')
const SOURCE = path.join(ROOT, 'mac', 'main.swift')

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
  })
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await portOpen(port)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`port ${port} did not open`)
}

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'ws'))) {
  const install = spawnSync('npm', ['install', '--registry', 'https://registry.npmjs.org'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (install.status !== 0) process.exit(install.status ?? 1)
}

if (!(await portOpen(PORT))) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  await waitForPort(PORT)
}

fs.mkdirSync(path.dirname(BIN), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'mac', 'Info.plist'), path.join(APP, 'Contents', 'Info.plist'))
const binaryTime = fs.existsSync(BIN) ? fs.statSync(BIN).mtimeMs : 0
if (fs.statSync(SOURCE).mtimeMs > binaryTime) {
  const compiled = spawnSync('swiftc', [
    '-O', '-o', BIN, SOURCE, '-framework', 'Cocoa', '-framework', 'WebKit', '-framework', 'AVFoundation', '-framework', 'AudioToolbox',
  ], { stdio: 'inherit' })
  if (compiled.status !== 0) process.exit(compiled.status ?? 1)
  spawnSync('codesign', ['--force', '--sign', '-', '--identifier', 'local.shorekeeper.pet', APP], { stdio: 'inherit' })
}

const pet = spawn('open', ['-n', '--env', `PET_PORT=${PORT}`, APP], {
  detached: true,
  stdio: 'ignore',
})
pet.unref()
console.log(`http://127.0.0.1:${PORT}/pet`)
