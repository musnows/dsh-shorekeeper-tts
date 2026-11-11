import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const STT_CHOICES = [
  { id: 'inworld/inworld-stt-1', label: '单语言' },
  { id: 'soniox/stt-rt-v4', label: '多语言混杂' },
]

const FILE = join(homedir(), '.dsh', 'shorekeeper-pet.json')
const LEGACY_STT = join(homedir(), '.dsh', 'shorekeeper-stt-model')
const GATE_MIN = 0
const GATE_MAX = 0.08
const GATE_STEP = 0.001
const GATE_DEFAULT = 0.012

export function snapPetGate(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return GATE_DEFAULT
  const steps = Math.round((number - GATE_MIN) / GATE_STEP)
  const snapped = Math.round((GATE_MIN + steps * GATE_STEP) * 1000) / 1000
  if (snapped < GATE_MIN) return GATE_MIN
  if (snapped > GATE_MAX) return GATE_MAX
  return snapped
}

function knownStt(id) {
  return STT_CHOICES.some(item => item.id === id)
}

export function readPetSettings() {
  const settings = {
    sttModel: STT_CHOICES[0].id,
    inputGate: GATE_DEFAULT,
  }
  try {
    const legacy = readFileSync(LEGACY_STT, 'utf8').trim()
    if (knownStt(legacy)) settings.sttModel = legacy
  } catch {
    // Older installs kept only the model id in a separate file.
  }
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    if (knownStt(raw?.sttModel)) settings.sttModel = raw.sttModel
    if (raw?.inputGate != null) settings.inputGate = snapPetGate(raw.inputGate)
  } catch {
    // A missing file keeps the defaults above.
  }
  return settings
}

export function writePetSettings(patch) {
  const current = readPetSettings()
  const next = { ...current }
  if (patch.sttModel != null) {
    if (!knownStt(patch.sttModel)) return null
    next.sttModel = patch.sttModel
  }
  if (patch.inputGate != null) next.inputGate = snapPetGate(patch.inputGate)
  writeFileSync(FILE, `${JSON.stringify(next)}\n`)
  return next
}
