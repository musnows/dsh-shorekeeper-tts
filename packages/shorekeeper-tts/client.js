window.__ModuleLoader__.load({
  id: '@dsh-local/shorekeeper-tts',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const exports = {}

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
    const ENTRY_ID = '守岸人语音'
    const STYLE_ID = 'shorekeeper-speaking-rate-v13'
    const SPEAK_CHANNEL = '/shorekeeper-tts'

    function snapSpeakingRate(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return 1
      const steps = Math.round((number - RATE_MIN) / RATE_STEP)
      const snapped = Math.round((RATE_MIN + steps * RATE_STEP) * 10) / 10
      if (snapped < RATE_MIN) return RATE_MIN
      if (snapped > RATE_MAX) return RATE_MAX
      return snapped
    }

    function snapVolume(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return 1
      const steps = Math.round((number - VOLUME_MIN) / VOLUME_STEP)
      const snapped = Math.round((VOLUME_MIN + steps * VOLUME_STEP) * 10) / 10
      if (snapped < VOLUME_MIN) return VOLUME_MIN
      if (snapped > VOLUME_MAX) return VOLUME_MAX
      return snapped
    }

    function snapMinSpoken(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return SPOKEN_DEFAULT
      const steps = Math.round((number - SPOKEN_MIN) / SPOKEN_STEP)
      const snapped = SPOKEN_MIN + steps * SPOKEN_STEP
      if (snapped < SPOKEN_MIN) return SPOKEN_MIN
      if (snapped > SPOKEN_MAX) return SPOKEN_MAX
      return snapped
    }

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '.shorekeeper-rate-label{appearance:none;-webkit-appearance:none;background:transparent;border:0;box-shadow:none;padding:0;margin:0;font-family:inherit;font-weight:inherit;font-size:var(--dsh-content-font-size-secondary);line-height:inherit;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
        '.shorekeeper-rate-label:hover,.shorekeeper-rate-label:focus,.shorekeeper-rate-label:active{background:transparent;border:0;box-shadow:none;outline:none;}',
        '.shorekeeper-rate{appearance:none;-webkit-appearance:none;width:208px;height:16px;margin:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
        '.shorekeeper-rate:focus{outline:none;}',
        '.shorekeeper-rate::-webkit-slider-runnable-track{height:2px;border-radius:1px;background:linear-gradient(to right,currentColor 0,currentColor var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) 100%);}',
        '.shorekeeper-rate::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:8px;height:8px;margin-top:-3px;border:0;border-radius:50%;background:currentColor;}',
        '.shorekeeper-rate::-moz-range-track{height:2px;border:0;border-radius:1px;background:linear-gradient(to right,currentColor 0,currentColor var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) 100%);}',
        '.shorekeeper-rate::-moz-range-thumb{width:8px;height:8px;border:0;border-radius:50%;background:currentColor;}',
        '.shorekeeper-rate-pop{position:fixed;z-index:80;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:max-content;min-width:232px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:10px 12px;border-radius:8px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-tertiary);}',
        '.shorekeeper-rate-actions{display:flex;align-items:center;gap:12px;}',
        '.shorekeeper-rate-row{display:flex;flex-direction:column;align-items:stretch;gap:6px;}',
        '.shorekeeper-rate-row-label{font-size:var(--dsh-content-font-size-secondary);color:var(--dsw-alias-label-tertiary);}',
        '.shorekeeper-rate-stop{appearance:none;-webkit-appearance:none;background:transparent;border:0;box-shadow:none;padding:0;margin:0;font-family:inherit;font-weight:inherit;font-size:var(--dsh-content-font-size-secondary);line-height:inherit;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;}',
        '.shorekeeper-rate-stop:hover,.shorekeeper-rate-stop:focus,.shorekeeper-rate-stop:active{background:transparent;border:0;box-shadow:none;outline:none;}',
        '.shorekeeper-rate-config{display:flex;flex-direction:column;align-items:flex-start;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary);}',
        '.shorekeeper-rate-summary,.shorekeeper-rate-error{font-size:var(--dsh-content-font-size-secondary);color:var(--dsw-alias-label-tertiary);}',
        '.shorekeeper-speak-action{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
        '.shorekeeper-speak-action:hover{background:var(--dsw-alias-fill-hover,transparent);}',
        '.shorekeeper-speak-action:disabled{opacity:.45;cursor:default;}',
        '.shorekeeper-speak-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));display:block;}',
        '.shorekeeper-speak-action[data-busy="true"]{color:var(--dsw-alias-label-secondary);}',
        '.shorekeeper-speak-action[data-error="true"]{color:var(--dsw-alias-status-danger, #d94c4c);}',
        '.shorekeeper-rate-divider{height:1px;margin:0;background:var(--dsw-alias-border-l3);}',
        '.shorekeeper-rate-pet{display:flex;flex-direction:column;align-items:stretch;gap:10px;}',
        '.shorekeeper-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
        '.shorekeeper-switch{position:relative;width:28px;height:16px;flex:0 0 auto;border:0;border-radius:8px;padding:0;background:var(--dsw-alias-border-l3);cursor:pointer;}',
        '.shorekeeper-switch[aria-checked="true"]{background:currentColor;}',
        '.shorekeeper-switch-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-specific-menu,#fff);}',
        '.shorekeeper-switch[aria-checked="true"] .shorekeeper-switch-knob{left:14px;}',
        '.shorekeeper-gate{position:relative;flex:1;display:flex;align-items:center;min-width:0;}',
        '.shorekeeper-gate .dshsk-range{width:100%;}',
        '.shorekeeper-gate-line{position:absolute;z-index:1;top:50%;width:1px;height:10px;margin-top:-5px;background:#f2feff;pointer-events:none;left:calc(8px + (100% - 16px) * var(--shorekeeper-level));}',
      ].join('')
      document.head.appendChild(style)
    }

    function SpeakIcon() {
      return React.createElement('svg', {
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
      },
      React.createElement('path', {
        d: 'M2.5 6.25v3.5c0 .69.56 1.25 1.25 1.25h1.4L8.2 13.3a.75.75 0 0 0 1.2-.6V3.3a.75.75 0 0 0-1.2-.6L5.15 5H3.75c-.69 0-1.25.56-1.25 1.25Z',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', {
        d: 'M11.1 5.6a2.6 2.6 0 0 1 0 4.8M12.7 4a4.4 4.4 0 0 1 0 8',
        stroke: 'currentColor',
        strokeWidth: '1.2',
        strokeLinecap: 'round',
      }))
    }

    function SpeakAction({ messageId, sessionId, connection }) {
      const busyState = React.useState(false)
      const busy = busyState[0]
      const setBusy = busyState[1]
      const errorState = React.useState(null)
      const error = errorState[0]
      const setError = errorState[1]

      async function onSpeak() {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          const rpc = connection?.rpc
          if (!rpc?.call) throw new Error('连接不可用')
          if (!messageId) throw new Error('缺少消息 id')
          if (!sessionId) throw new Error('缺少会话 id')
          const result = await rpc.call(SPEAK_CHANNEL, 'speak', {
            sessionId,
            messageId,
          })
          if (!result?.ok) throw new Error(result?.error?.message || '朗读失败')
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught)
          setError(message)
          console.error(`[dsh-shorekeeper-tts] speak failed: ${message}`)
        } finally {
          setBusy(false)
        }
      }

      return React.createElement('button', {
        type: 'button',
        className: 'shorekeeper-speak-action',
        'aria-label': error ? `朗读失败：${error}` : (busy ? '正在朗读' : '语音重播'),
        title: error ? `朗读失败：${error}` : (busy ? '正在朗读' : '用守岸人音色重播这条回复'),
        disabled: busy,
        'data-busy': busy || undefined,
        'data-error': error ? 'true' : undefined,
        onClick() { void onSpeak() },
      }, React.createElement(SpeakIcon))
    }

    function snapshotOf(form) {
      if (!form) return null
      return typeof form.getSnapshot === 'function' ? form.getSnapshot() : form
    }

    function rateOf(form) {
      const snapshot = snapshotOf(form)
      if (!snapshot) return 1
      const raw = snapshot?.value?.speakingRate ?? snapshot?.speakingRate
      if (raw == null) return 1
      return snapSpeakingRate(raw)
    }

    function minSpokenFrom(form) {
      const snapshot = snapshotOf(form)
      if (!snapshot) return SPOKEN_DEFAULT
      const raw = snapshot?.value?.minSpoken ?? snapshot?.minSpoken
      if (raw == null) return SPOKEN_DEFAULT
      return snapMinSpoken(raw)
    }

    function volumeFrom(form) {
      const snapshot = snapshotOf(form)
      if (!snapshot) return 1
      const raw = snapshot?.value?.volume ?? snapshot?.volume
      if (raw == null) return 1
      return snapVolume(raw)
    }

    function enabledOf(form) {
      const snapshot = snapshotOf(form)
      if (!snapshot) return true
      const raw = snapshot?.value?.enabled ?? snapshot?.enabled
      if (raw == null) return true
      return raw !== false
    }

    function snapGate(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return GATE_DEFAULT
      const steps = Math.round((number - GATE_MIN) / GATE_STEP)
      const snapped = Math.round((GATE_MIN + steps * GATE_STEP) * 1000) / 1000
      if (snapped < GATE_MIN) return GATE_MIN
      if (snapped > GATE_MAX) return GATE_MAX
      return snapped
    }

    function gateFrom(form) {
      const snapshot = snapshotOf(form)
      if (!snapshot) return GATE_DEFAULT
      const raw = snapshot?.value?.inputGate ?? snapshot?.inputGate
      if (raw == null) return GATE_DEFAULT
      return snapGate(raw)
    }

    function subscribeForm(form, listener) {
      if (!form) return () => {}
      if (typeof form.subscribe === 'function') {
        const dispose = form.subscribe(listener)
        return typeof dispose === 'function' ? dispose : () => {}
      }
      return () => {}
    }

    function useEntryForm(forms) {
      const read = React.useCallback(() => forms?.get?.(ENTRY_ID) ?? null, [forms])
      const formState = React.useState(read)
      const form = formState[0]
      const setForm = formState[1]
      React.useEffect(() => {
        setForm(read())
        if (typeof forms?.subscribe !== 'function') return undefined
        return forms.subscribe(() => setForm(read()))
      }, [forms, read])
      return form
    }

    function useVolatileNumber(form, {
      read,
      fallback,
      snap,
      key,
    }) {
      const subscribe = React.useCallback(listener => subscribeForm(form, listener), [form])
      const getSnapshot = React.useCallback(() => read(form), [form, read])
      const stored = React.useSyncExternalStore(subscribe, getSnapshot, () => fallback)
      const draftState = React.useState(null)
      const draft = draftState[0]
      const setDraft = draftState[1]
      const failedState = React.useState(false)
      const failed = failedState[0]
      const setFailed = failedState[1]
      React.useEffect(() => {
        if (draft != null && stored === draft) setDraft(null)
      }, [stored, draft])

      async function commit(raw) {
        const snapped = snap(Number(raw))
        setDraft(snapped)
        setFailed(false)
        if (!form || typeof form.set !== 'function') {
          setFailed(true)
          return
        }
        try {
          const accepted = await form.set(key, snapped)
          if (accepted === false) setFailed(true)
        } catch {
          setFailed(true)
        }
      }

      return { shown: draft ?? stored, failed, commit }
    }

    function useSpeakingRate(form) {
      return useVolatileNumber(form, {
        read: rateOf,
        fallback: 1,
        snap: snapSpeakingRate,
        key: 'speakingRate',
      })
    }

    function useVolume(form) {
      return useVolatileNumber(form, {
        read: volumeFrom,
        fallback: 1,
        snap: snapVolume,
        key: 'volume',
      })
    }

    function useMinSpoken(form) {
      return useVolatileNumber(form, {
        read: minSpokenFrom,
        fallback: SPOKEN_DEFAULT,
        snap: snapMinSpoken,
        key: 'minSpoken',
      })
    }

    function useSavedGate(connection) {
      const pair = React.useState(GATE_DEFAULT)
      const shown = pair[0]
      const setShown = pair[1]
      const errorPair = React.useState('')
      const error = errorPair[0]
      const setError = errorPair[1]
      React.useEffect(() => {
        let stopped = false
        async function load() {
          const rpc = connection?.rpc
          if (!rpc?.call) return
          try {
            const result = await rpc.call(SPEAK_CHANNEL, 'gate', {})
            if (stopped || !result?.ok) return
            const value = Number(result.value?.value)
            if (Number.isFinite(value)) setShown(snapGate(value))
          } catch {
            // The slider stays on the last value written to this page.
          }
        }
        void load()
        return () => { stopped = true }
      }, [connection])

      async function commit(raw) {
        const snapped = snapGate(raw)
        setShown(snapped)
        setError('')
        const rpc = connection?.rpc
        if (!rpc?.call) {
          setError('连接不可用')
          return
        }
        try {
          const result = await rpc.call(SPEAK_CHANNEL, 'gate', { value: snapped })
          if (!result?.ok) throw new Error(result?.error?.message || '没有写到本机')
          const value = Number(result.value?.value)
          if (Number.isFinite(value)) setShown(snapGate(value))
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '没有写到本机')
        }
      }

      return { shown, error, commit }
    }

    function useSpeechEnabled(form) {
      const subscribe = React.useCallback(listener => subscribeForm(form, listener), [form])
      const getSnapshot = React.useCallback(() => enabledOf(form), [form])
      const stored = React.useSyncExternalStore(subscribe, getSnapshot, () => true)
      const draftState = React.useState(null)
      const draft = draftState[0]
      const setDraft = draftState[1]
      const failedState = React.useState(false)
      const failed = failedState[0]
      const setFailed = failedState[1]
      React.useEffect(() => {
        if (draft != null && stored === draft) setDraft(null)
      }, [stored, draft])

      async function commit(next) {
        setDraft(next)
        setFailed(false)
        if (!form || typeof form.set !== 'function') {
          setFailed(true)
          return
        }
        try {
          const accepted = await form.set('enabled', next)
          if (accepted === false) setFailed(true)
        } catch {
          setFailed(true)
        }
      }

      return { shown: draft ?? stored, failed, commit }
    }

    function RangeSlider({
      value,
      min,
      max,
      step,
      fill,
      label,
      onChange,
    }) {
      return React.createElement('input', {
        className: 'shorekeeper-rate',
        type: 'range',
        min,
        max,
        step,
        value,
        'aria-label': label,
        style: { '--shorekeeper-rate-fill': fill },
        onChange(event) { onChange(event.target.value) },
      })
    }

    function RateSlider({ value, onChange }) {
      const fill = `${((value - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%`
      return React.createElement(RangeSlider, {
        value,
        min: RATE_MIN,
        max: RATE_MAX,
        step: RATE_STEP,
        fill,
        label: '语速',
        onChange,
      })
    }

    function VolumeSlider({ value, onChange }) {
      const fill = `${((value - VOLUME_MIN) / (VOLUME_MAX - VOLUME_MIN)) * 100}%`
      return React.createElement(RangeSlider, {
        value,
        min: VOLUME_MIN,
        max: VOLUME_MAX,
        step: VOLUME_STEP,
        fill,
        label: '音量',
        onChange,
      })
    }

    function MinSpokenSlider({ value, onChange }) {
      const fill = `${((value - SPOKEN_MIN) / (SPOKEN_MAX - SPOKEN_MIN)) * 100}%`
      return React.createElement(RangeSlider, {
        value,
        min: SPOKEN_MIN,
        max: SPOKEN_MAX,
        step: SPOKEN_STEP,
        fill,
        label: '起送字数',
        onChange,
      })
    }

    function ToggleSwitch({ on, label, onToggle }) {
      return React.createElement('button', {
        type: 'button',
        className: 'shorekeeper-switch',
        role: 'switch',
        'aria-checked': on,
        'aria-label': label,
        onClick() { onToggle() },
      }, React.createElement('span', { className: 'shorekeeper-switch-knob' }))
    }

    function SwitchRow({ title, on, label, onToggle }) {
      return React.createElement('div', { className: 'shorekeeper-switch-row' },
        React.createElement('div', { className: 'shorekeeper-rate-row-label' }, title),
        React.createElement(ToggleSwitch, { on, label, onToggle }),
      )
    }

    async function callPet(connection, payload) {
      const rpc = connection?.rpc
      if (!rpc?.call) throw new Error('连接不可用')
      const result = await rpc.call(SPEAK_CHANNEL, 'pet', payload ?? {})
      if (!result?.ok) throw new Error(result?.error?.message || '桌宠没有打开')
      return result.value && typeof result.value === 'object' ? result.value : result
    }

    function usePet(connection, watch) {
      const statePair = React.useState({ enabled: false, error: '' })
      const state = statePair[0]
      const setState = statePair[1]
      React.useEffect(() => {
        if (!watch) return undefined
        let stopped = false
        async function poll() {
          try {
            const body = await callPet(connection, {})
            if (!stopped) setState({ enabled: body.enabled === true, error: '' })
          } catch (caught) {
            if (stopped) return
            const message = caught instanceof Error ? caught.message : '桌宠没有打开'
            setState(current => ({ ...current, error: message }))
          }
        }
        void poll()
        const timer = setInterval(() => { void poll() }, 1500)
        return () => {
          stopped = true
          clearInterval(timer)
        }
      }, [connection, watch])

      async function setEnabled(next) {
        setState(current => ({ ...current, enabled: next, error: '' }))
        try {
          const body = await callPet(connection, { enabled: next })
          setState({ enabled: body.enabled === true, error: '' })
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : '桌宠没有打开'
          setState(current => ({ enabled: !next, error: message }))
        }
      }

      return { enabled: state.enabled, error: state.error, setEnabled }
    }

    const STT_FALLBACK = [
      { id: 'inworld/inworld-stt-1', label: '单语言' },
      { id: 'soniox/stt-rt-v4', label: '多语言混杂' },
    ]

    function useStt(connection) {
      const pair = React.useState({ model: STT_FALLBACK[0].id, choices: STT_FALLBACK, error: '' })
      const state = pair[0]
      const setState = pair[1]
      React.useEffect(() => {
        let stopped = false
        async function load() {
          const rpc = connection?.rpc
          if (!rpc?.call) return
          try {
            const result = await rpc.call(SPEAK_CHANNEL, 'stt', {})
            if (stopped || !result?.ok) return
            const value = result.value && typeof result.value === 'object' ? result.value : {}
            const choices = Array.isArray(value.choices) && value.choices.length > 0 ? value.choices : STT_FALLBACK
            const model = typeof value.model === 'string' ? value.model : choices[0].id
            setState({ model, choices, error: '' })
          } catch {
            // The theme page still offers the two known models.
          }
        }
        void load()
        return () => { stopped = true }
      }, [connection])

      async function select(model) {
        setState(current => ({ ...current, model, error: '' }))
        const rpc = connection?.rpc
        if (!rpc?.call) {
          setState(current => ({ ...current, error: '连接不可用' }))
          return
        }
        try {
          const result = await rpc.call(SPEAK_CHANNEL, 'stt', { model })
          if (!result?.ok) throw new Error(result?.error?.message || '没有换过去')
          const value = result.value && typeof result.value === 'object' ? result.value : {}
          const choices = Array.isArray(value.choices) && value.choices.length > 0 ? value.choices : STT_FALLBACK
          setState({
            model: typeof value.model === 'string' ? value.model : model,
            choices,
            error: '',
          })
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : '没有换过去'
          setState(current => ({ ...current, error: message }))
        }
      }

      return { model: state.model, choices: state.choices, error: state.error, select }
    }

    function useMicLevel(connection, on) {
      const levelState = React.useState(0)
      const level = levelState[0]
      const setLevel = levelState[1]
      React.useEffect(() => {
        if (!on) {
          setLevel(0)
          return undefined
        }
        let stopped = false
        async function tick() {
          while (!stopped) {
            try {
              const body = await callPet(connection, {})
              if (!stopped) setLevel(Number(body.level) || 0)
            } catch {
              if (!stopped) setLevel(0)
            }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
        void tick()
        return () => { stopped = true }
      }, [connection, on])
      return level
    }

    function RateBody({ rate, volume, minSpoken, speech }) {
      const saveFailed = rate.failed || volume.failed || minSpoken.failed || speech.failed
      return React.createElement(React.Fragment, null,
        React.createElement(SwitchRow, {
          title: '语音播报',
          on: speech.shown,
          label: speech.shown ? '关闭播报' : '打开播报',
          onToggle() { speech.commit(!speech.shown) },
        }),
        React.createElement('div', { className: 'shorekeeper-rate-row' },
          React.createElement('div', { className: 'shorekeeper-rate-row-label' }, `语速 ${rate.shown.toFixed(1)}x`),
          React.createElement(RateSlider, { value: rate.shown, onChange: rate.commit }),
        ),
        React.createElement('div', { className: 'shorekeeper-rate-row' },
          React.createElement('div', { className: 'shorekeeper-rate-row-label' }, `起送 ${minSpoken.shown} 字`),
          React.createElement(MinSpokenSlider, { value: minSpoken.shown, onChange: minSpoken.commit }),
        ),
        React.createElement('div', { className: 'shorekeeper-rate-row' },
          React.createElement('div', { className: 'shorekeeper-rate-row-label' }, `音量 ${volume.shown.toFixed(1)}`),
          React.createElement(VolumeSlider, { value: volume.shown, onChange: volume.commit }),
        ),
        saveFailed ? React.createElement('div', { className: 'shorekeeper-rate-error' }, '没有保存') : null,
      )
    }

    function PetThemeSection({ connection, forms }) {
      const pet = usePet(connection, true)
      const stt = useStt(connection)
      const gate = useSavedGate(connection)
      const level = useMicLevel(connection, pet.enabled)
      const gatePercent = Math.round((gate.shown / GATE_MAX) * 100)
      const levelRatio = Math.min(1, Math.max(0, level / GATE_MAX))
      return React.createElement('section', { className: 'dshsk-card' },
        React.createElement('div', { className: 'dshsk-card-head' },
          React.createElement('h2', null, '桌面宠物'),
          React.createElement('p', null, '在桌面上打开守岸人，对着她说话。'),
        ),
        React.createElement('div', { className: 'dshsk-row' },
          React.createElement('div', { className: 'dshsk-row-label' },
            React.createElement('strong', null, '桌面宠物'),
            React.createElement('span', null, '打开后停在屏幕上，可以随时关掉'),
          ),
          React.createElement('div', { className: 'dshsk-row-control' },
            React.createElement('button', {
              className: 'dshsk-switch' + (pet.enabled ? ' is-on' : ''),
              type: 'button',
              role: 'switch',
              'aria-checked': pet.enabled ? 'true' : 'false',
              'aria-label': pet.enabled ? '关闭桌宠' : '打开桌宠',
              onClick() { void pet.setEnabled(!pet.enabled) },
            }, React.createElement('i')),
          ),
        ),
        React.createElement('div', { className: 'dshsk-row' },
          React.createElement('div', { className: 'dshsk-row-label' },
            React.createElement('strong', null, '识别模型'),
            React.createElement('span', null, '单语言整段只听一种，多语言混杂可以在一句里夹着别的语言'),
          ),
          React.createElement('div', { className: 'dshsk-row-control', style: { width: 'auto', marginLeft: 'auto', flex: 'none' } },
            React.createElement('div', { className: 'dshsk-seg', style: { marginBottom: 0 } },
              stt.choices.map(choice => React.createElement('button', {
                key: choice.id,
                type: 'button',
                'data-active': stt.model === choice.id ? 'true' : 'false',
                onClick() { void stt.select(choice.id) },
              }, choice.label)),
            ),
          ),
        ),
        pet.enabled
          ? React.createElement('div', { className: 'dshsk-row' },
            React.createElement('div', { className: 'dshsk-row-label' },
              React.createElement('strong', null, '收音阈值'),
              React.createElement('span', null, '声音超过这条线才开始听'),
            ),
            React.createElement('div', { className: 'dshsk-row-control' },
              React.createElement('div', { className: 'shorekeeper-gate' },
                React.createElement('input', {
                  type: 'range',
                  className: 'dshsk-range',
                  min: 0,
                  max: 100,
                  step: 1,
                  value: gatePercent,
                  'aria-label': '收音阈值',
                  onChange(event) { void gate.commit((Number(event.target.value) / 100) * GATE_MAX) },
                }),
                React.createElement('span', {
                  className: 'shorekeeper-gate-line',
                  role: 'meter',
                  'aria-label': '麦克风',
                  style: { '--shorekeeper-level': String(levelRatio) },
                }),
              ),
              React.createElement('span', { className: 'dshsk-value' }, `${gatePercent}%`),
            ),
          )
          : null,
        pet.error ? React.createElement('div', { className: 'dshsk-note' }, pet.error) : null,
        gate.error ? React.createElement('div', { className: 'dshsk-note' }, gate.error) : null,
        stt.error ? React.createElement('div', { className: 'dshsk-note' }, stt.error) : null,
      )
    }

    function DockRate({ forms, connection }) {
      const form = useEntryForm(forms)
      const rate = useSpeakingRate(form)
      const volume = useVolume(form)
      const minSpoken = useMinSpoken(form)
      const speech = useSpeechEnabled(form)
      const openState = React.useState(false)
      const open = openState[0]
      const setOpen = openState[1]
      const labelRef = React.useRef(null)
      const popRef = React.useRef(null)
      const placeState = React.useState({ top: 0, left: 0 })
      const place = placeState[0]
      const setPlace = placeState[1]

      const updatePlace = React.useCallback(() => {
        const label = labelRef.current
        const pop = popRef.current
        if (!label || !pop) return
        const rect = label.getBoundingClientRect()
        const margin = 8
        const width = pop.offsetWidth
        const height = pop.offsetHeight
        let top = rect.top - margin - height
        if (top < margin) top = rect.bottom + margin
        const maxTop = window.innerHeight - height - margin
        if (top > maxTop) top = Math.max(margin, maxTop)
        let left = rect.left + (rect.width - width) / 2
        const maxLeft = window.innerWidth - width - margin
        if (left < margin) left = margin
        if (left > maxLeft) left = Math.max(margin, maxLeft)
        setPlace(current => (current.top === top && current.left === left ? current : { top, left }))
      }, [])

      React.useLayoutEffect(() => {
        if (!open) return undefined
        updatePlace()
        const pop = popRef.current
        const observer = typeof ResizeObserver === 'function' && pop ? new ResizeObserver(() => updatePlace()) : null
        if (observer && pop) observer.observe(pop)
        const onScroll = () => updatePlace()
        const onKey = event => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointer = event => {
          if (labelRef.current?.contains(event.target)) return
          if (popRef.current?.contains(event.target)) return
          setOpen(false)
        }
        window.addEventListener('resize', onScroll)
        window.addEventListener('scroll', onScroll, true)
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onPointer)
        return () => {
          observer?.disconnect()
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('scroll', onScroll, true)
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onPointer)
        }
      }, [open, rate.failed, volume.failed, minSpoken.failed, speech.failed, updatePlace])

      const label = React.createElement('button', {
        ref: labelRef,
        type: 'button',
        className: 'shorekeeper-rate-label',
        'aria-expanded': open,
        onClick() { setOpen(current => !current) },
      }, speech.shown ? `语速 ${rate.shown.toFixed(1)}x` : '语音已关')

      const pop = open
        ? ReactDOM.createPortal(React.createElement('div', {
          ref: popRef,
          className: 'shorekeeper-rate-pop',
          style: { top: `${place.top}px`, left: `${place.left}px` },
        },
        React.createElement(RateBody, { rate, volume, minSpoken, speech }),
        ), document.body)
        : null

      return React.createElement(React.Fragment, null, label, pop)
    }

    function ConfigRate({ forms, connection }) {
      const form = useEntryForm(forms)
      const rate = useSpeakingRate(form)
      const volume = useVolume(form)
      const minSpoken = useMinSpoken(form)
      const speech = useSpeechEnabled(form)
      return React.createElement('div', { className: 'shorekeeper-rate-config' },
        React.createElement('div', { className: 'shorekeeper-rate-summary' }, '语速 0.8x–1.5x · 音量 0–1 · 起送 20–50 字'),
        React.createElement(RateBody, { rate, volume, minSpoken, speech }),
      )
    }

    function apply(ctx) {
      ensureStyles()
      const slots = ctx.slots ?? ctx.get?.('slots')
      const forms = ctx.configForms ?? ctx.get?.('configForms')
      const connection = ctx.connection ?? ctx.get?.('connection')
      let sessionsApi
      try {
        sessionsApi = ctx.get?.('sessions')
      } catch {
        sessionsApi = undefined
      }
      if (connection?.rpc?.call && sessionsApi?.refresh && !window.__shorekeeperSessionWatch) {
        window.__shorekeeperSessionWatch = true
        let seen = 0
        const pull = async () => {
          try {
            const result = await connection.rpc.call(SPEAK_CHANNEL, 'sessions', {})
            const revision = Number(result?.value?.revision)
            if (!Number.isFinite(revision) || revision <= seen) return
            seen = revision
            await sessionsApi.refresh()
          } catch {
            // The desktop plugin publishes a revision only after it is loaded.
          }
        }
        void pull()
        setInterval(() => { void pull() }, 1000)
      }
      if (!slots) return
      slots.inject('conversation.composer.dock', () => slots.register({
        name: 'conversation.composer.dock',
        id: 'shorekeeper-speaking-rate',
        order: 40,
      }, () => React.createElement(DockRate, { forms, connection })))
      slots.inject('plugins.row.config', () => slots.register({
        name: 'plugins.row.config',
        key: '@dsh-local/shorekeeper-tts#守岸人语音',
      }, () => React.createElement(ConfigRate, { forms, connection })))
      slots.inject('conversation.chat.assistant-actions', () => slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'shorekeeper-speak',
        order: 95,
        inject: sessionId => ({
          ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
          // Read connection at inject time so a late-ready Client handle is used.
          connection: ctx.connection ?? ctx.get?.('connection'),
        }),
      }, SpeakAction))
      slots.inject('shorekeeper.theme.pet', () => slots.register({
        name: 'shorekeeper.theme.pet',
        id: 'shorekeeper-pet',
      }, () => React.createElement(PetThemeSection, { forms, connection })))
    }

    exports.inject = ['slots', 'configForms', 'connection']
    exports.apply = apply
    return exports
  },
})
