window.__ModuleLoader__.load({
  id: '@dsh-local/shorekeeper-tts',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const exports = {}

    const RATE_MIN = 0.8
    const RATE_MAX = 1.5
    const RATE_STEP = 0.1
    const ENTRY_ID = '守岸人语音'
    const STYLE_ID = 'shorekeeper-speaking-rate-v2'

    function snapSpeakingRate(value) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return 1
      const steps = Math.round((number - RATE_MIN) / RATE_STEP)
      const snapped = Math.round((RATE_MIN + steps * RATE_STEP) * 10) / 10
      if (snapped < RATE_MIN) return RATE_MIN
      if (snapped > RATE_MAX) return RATE_MAX
      return snapped
    }

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '.shorekeeper-rate-label{appearance:none;-webkit-appearance:none;background:transparent;border:0;box-shadow:none;padding:0;margin:0;font-family:inherit;font-weight:inherit;font-size:var(--dsh-content-font-size-secondary);line-height:inherit;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
        '.shorekeeper-rate-label:hover,.shorekeeper-rate-label:focus,.shorekeeper-rate-label:active{background:transparent;border:0;box-shadow:none;outline:none;}',
        '.shorekeeper-rate{appearance:none;-webkit-appearance:none;width:148px;height:16px;margin:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
        '.shorekeeper-rate:focus{outline:none;}',
        '.shorekeeper-rate::-webkit-slider-runnable-track{height:2px;border-radius:1px;background:linear-gradient(to right,currentColor 0,currentColor var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) 100%);}',
        '.shorekeeper-rate::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:8px;height:8px;margin-top:-3px;border:0;border-radius:50%;background:currentColor;}',
        '.shorekeeper-rate::-moz-range-track{height:2px;border:0;border-radius:1px;background:linear-gradient(to right,currentColor 0,currentColor var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) var(--shorekeeper-rate-fill),var(--dsw-alias-border-l3) 100%);}',
        '.shorekeeper-rate::-moz-range-thumb{width:8px;height:8px;border:0;border-radius:50%;background:currentColor;}',
        '.shorekeeper-rate-pop{position:fixed;z-index:80;box-sizing:border-box;padding:10px 12px;border-radius:8px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-tertiary);}',
        '.shorekeeper-rate-config{display:flex;flex-direction:column;align-items:flex-start;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary);}',
        '.shorekeeper-rate-summary,.shorekeeper-rate-error{font-size:var(--dsh-content-font-size-secondary);color:var(--dsw-alias-label-tertiary);}',
      ].join('')
      document.head.appendChild(style)
    }

    function rateOf(form) {
      if (!form) return 1
      const snapshot = typeof form.getSnapshot === 'function' ? form.getSnapshot() : form
      const raw = snapshot?.value?.speakingRate ?? snapshot?.speakingRate
      if (raw == null) return 1
      return snapSpeakingRate(raw)
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

    function useSpeakingRate(form) {
      const subscribe = React.useCallback(listener => subscribeForm(form, listener), [form])
      const getSnapshot = React.useCallback(() => rateOf(form), [form])
      const stored = React.useSyncExternalStore(subscribe, getSnapshot, () => 1)
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
        const snapped = snapSpeakingRate(Number(raw))
        setDraft(snapped)
        setFailed(false)
        if (!form || typeof form.set !== 'function') {
          setFailed(true)
          return
        }
        try {
          const accepted = await form.set('speakingRate', snapped)
          if (accepted === false) setFailed(true)
        } catch {
          setFailed(true)
        }
      }

      return { shown: draft ?? stored, failed, commit }
    }

    function RateSlider({ value, onChange }) {
      const fill = `${((value - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%`
      return React.createElement('input', {
        className: 'shorekeeper-rate',
        type: 'range',
        min: RATE_MIN,
        max: RATE_MAX,
        step: RATE_STEP,
        value,
        'aria-label': '语速',
        style: { '--shorekeeper-rate-fill': fill },
        onChange(event) { onChange(event.target.value) },
      })
    }

    function DockRate({ forms }) {
      const form = useEntryForm(forms)
      const rate = useSpeakingRate(form)
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
        let left = rect.left + (rect.width - width) / 2
        const maxLeft = window.innerWidth - width - margin
        if (left < margin) left = margin
        if (left > maxLeft) left = Math.max(margin, maxLeft)
        setPlace({ top, left })
      }, [])

      React.useLayoutEffect(() => {
        if (!open) return undefined
        updatePlace()
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
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('scroll', onScroll, true)
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onPointer)
        }
      }, [open, rate.failed, updatePlace])

      const label = React.createElement('button', {
        ref: labelRef,
        type: 'button',
        className: 'shorekeeper-rate-label',
        'aria-expanded': open,
        onClick() { setOpen(current => !current) },
      }, `语速 ${rate.shown.toFixed(1)}x`)

      const pop = open
        ? ReactDOM.createPortal(React.createElement('div', {
          ref: popRef,
          className: 'shorekeeper-rate-pop',
          style: { top: `${place.top}px`, left: `${place.left}px` },
        },
        React.createElement(RateSlider, { value: rate.shown, onChange: rate.commit }),
        rate.failed ? React.createElement('div', { className: 'shorekeeper-rate-error' }, '没有保存') : null,
        ), document.body)
        : null

      return React.createElement(React.Fragment, null, label, pop)
    }

    function ConfigRate({ forms }) {
      const form = useEntryForm(forms)
      const rate = useSpeakingRate(form)
      return React.createElement('div', { className: 'shorekeeper-rate-config' },
        React.createElement('div', { className: 'shorekeeper-rate-summary' }, '语速 0.8x–1.5x'),
        React.createElement(RateSlider, { value: rate.shown, onChange: rate.commit }),
        rate.failed ? React.createElement('div', { className: 'shorekeeper-rate-error' }, '没有保存') : null,
      )
    }

    function apply(ctx) {
      ensureStyles()
      const slots = ctx.slots ?? ctx.get?.('slots')
      const forms = ctx.configForms ?? ctx.get?.('configForms')
      if (!slots) return
      slots.inject('conversation.composer.dock', () => slots.register({
        name: 'conversation.composer.dock',
        id: 'shorekeeper-speaking-rate',
        order: 40,
      }, () => React.createElement(DockRate, { forms })))
      slots.inject('plugins.row.config', () => slots.register({
        name: 'plugins.row.config',
        key: '@dsh-local/shorekeeper-tts#守岸人语音',
      }, () => React.createElement(ConfigRate, { forms })))
    }

    exports.inject = ['slots', 'configForms']
    exports.apply = apply
    return exports
  },
})
