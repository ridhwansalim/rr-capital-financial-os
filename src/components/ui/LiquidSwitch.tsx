import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

type NativeSwitchAttributes = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'defaultChecked' | 'type' | 'role' | 'aria-checked'
>

interface LiquidSwitchProps extends NativeSwitchAttributes {
  checked?: boolean
  defaultChecked?: boolean
  label?: string
  onCheckedChange?: (checked: boolean) => void
  onChange?: (checked: boolean) => void
  size?: 'sm' | 'md' | 'lg'
  role?: 'switch'
  'aria-checked'?: boolean | 'true' | 'false'
}

export default function LiquidSwitch({
  checked: checkedProp,
  defaultChecked = false,
  label,
  onCheckedChange,
  onChange,
  className = '',
  disabled = false,
  size = 'md',
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
  'aria-label': ariaLabel,
  ...props
}: LiquidSwitchProps) {
  const controlled = checkedProp !== undefined
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked)
  const checked = controlled ? checkedProp : uncontrolledChecked

  const buttonRef = useRef<HTMLButtonElement>(null)
  const checkedRef = useRef(checked)
  const completeRef = useRef(checked ? 100 : 0)
  const isAnimatingRef = useRef(false)
  const handledInputRef = useRef(false)

  const pointerRef = useRef({
    down: false,
    dragging: false,
    startX: 0,
    lastX: 0,
    dragBounds: 0,
    pressTime: 0,
  })

  const frameRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)

  const clamp = (min: number, max: number, val: number) =>
    Math.min(Math.max(val, min), max)

  const mapRange = (
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
    val: number
  ) => outMin + ((val - inMin) / (inMax - inMin || 1)) * (outMax - outMin)

  const setComplete = useCallback((value: number) => {
    const next = clamp(0, 100, value)
    completeRef.current = next
    buttonRef.current?.style.setProperty('--complete', String(next))
  }, [])

  const setActiveState = useCallback((active: boolean, pressed: boolean) => {
    const btn = buttonRef.current
    if (!btn) return
    btn.dataset.active = String(active)
    btn.dataset.pressed = String(pressed)
  }, [])

  const emitChange = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledChecked(next)
      onCheckedChange?.(next)
      onChange?.(next)
    },
    [controlled, onCheckedChange, onChange]
  )

  const animateSlide = useCallback(
    (next: boolean, delayMs: number, durationMs: number, shouldEmit = true) => {
      if (disabled) return
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)

      const btn = buttonRef.current
      if (!btn) return

      isAnimatingRef.current = true
      setActiveState(true, true)

      const from = completeRef.current
      const to = next ? 100 : 0
      const startTime = performance.now() + delayMs

      const tick = (now: number) => {
        if (now < startTime) {
          frameRef.current = requestAnimationFrame(tick)
          return
        }
        const elapsed = now - startTime
        const progress = clamp(0, 1, elapsed / durationMs)
        // Smooth cubic ease-out for horizontal travel; CSS handles the liquid scale bounce.
        const eased = 1 - Math.pow(1 - progress, 3)
        setComplete(from + (to - from) * eased)

        if (progress < 1) {
          frameRef.current = requestAnimationFrame(tick)
          return
        }

        frameRef.current = null
        btn.setAttribute('aria-pressed', String(next))
        checkedRef.current = next
        if (shouldEmit) emitChange(next)

        settleTimerRef.current = window.setTimeout(() => {
          setActiveState(false, false)
          isAnimatingRef.current = false
        }, 50)
      }

      frameRef.current = requestAnimationFrame(tick)
    },
    [disabled, emitChange, setActiveState, setComplete]
  )

  // Sync external controlled prop changes only when not actively dragging/animating.
  useLayoutEffect(() => {
    if (pointerRef.current.down || isAnimatingRef.current) return
    checkedRef.current = checked
    setComplete(checked ? 100 : 0)
    buttonRef.current?.setAttribute('aria-pressed', String(checked))
    setActiveState(false, false)
  }, [checked, setActiveState, setComplete])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    },
    []
  )

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event)
    if (event.defaultPrevented || disabled || event.button !== 0) return

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)

    const rect = event.currentTarget.getBoundingClientRect()
    const isPressed = checkedRef.current
    const dragBounds = isPressed
      ? rect.left - event.clientX
      : rect.left + rect.width - event.clientX

    pointerRef.current = {
      down: true,
      dragging: false,
      startX: event.clientX,
      lastX: event.clientX,
      dragBounds,
      pressTime: performance.now(),
    }

    setActiveState(true, true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event)
    const p = pointerRef.current
    if (!p.down || disabled) return

    const dragged = event.clientX - p.startX
    if (Math.abs(dragged) > 4) p.dragging = true

    const isPressed = checkedRef.current
    const rawComplete = isPressed
      ? mapRange(p.dragBounds, 0, 0, 100, dragged)
      : mapRange(0, p.dragBounds, 0, 100, dragged)

    setComplete(rawComplete)

    const delta = Math.min(Math.abs(event.clientX - p.lastX), 12)
    p.lastX = event.clientX
    event.currentTarget.style.setProperty('--delta', String(delta))
  }

  const finishPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false
  ) => {
    if (cancelled) onPointerCancel?.(event)
    else onPointerUp?.(event)

    const p = pointerRef.current
    if (!p.down) return
    p.down = false

    event.currentTarget.style.setProperty('--delta', '0')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const pressDuration = performance.now() - p.pressTime
    handledInputRef.current = true
    window.setTimeout(() => {
      handledInputRef.current = false
    }, 0)

    // A tap or quick flick gives the glass bubble time to inflate before it slides.
    if (!p.dragging || pressDuration <= 160) {
      const next = !checkedRef.current
      const remainingInflationDelay = Math.max(0, 160 - pressDuration)
      animateSlide(next, remainingInflationDelay, 130, true)
      return
    }

    // A longer drag snaps to the nearest state.
    const finalState = completeRef.current >= 50
    animateSlide(finalState, 0, 150, true)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || disabled) return
    if (event.key === 'Enter' && !event.repeat) {
      event.preventDefault()
      handledInputRef.current = true
      window.setTimeout(() => {
        handledInputRef.current = false
      }, 0)
      animateSlide(!checkedRef.current, 160, 130, true)
    } else if (event.key === ' ') {
      event.preventDefault()
      setActiveState(true, true)
    }
  }

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyUp?.(event)
    if (event.defaultPrevented || disabled || event.key !== ' ') return
    handledInputRef.current = true
    window.setTimeout(() => {
      handledInputRef.current = false
    }, 0)
    animateSlide(!checkedRef.current, 60, 130, true)
  }

  const dimensions =
    size === 'sm'
      ? { '--width': 48, '--height': 24, '--border': '2px' }
      : size === 'lg'
        ? { '--width': 68, '--height': 34, '--border': '3px' }
        : { '--width': 56, '--height': 28, '--border': '2.5px' }

  return (
    <button
      {...props}
      ref={buttonRef}
      type="button"
      role="switch"
      aria-label={label ?? ariaLabel}
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled}
      className={`liquid-toggle liquid-switch ${className}`.trim()}
      style={{ ...dimensions, ...props.style } as CSSProperties}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || event.detail !== 0 || handledInputRef.current || disabled) return
        // Preserve activation from assistive technology that dispatches click without pointer/key events.
        animateSlide(!checkedRef.current, 160, 130, true)
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointer(event, false)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <span className="knockout" aria-hidden="true">
        <span className="indicator indicator--masked">
          <span className="mask" />
        </span>
      </span>
      <span className="indicator__liquid" aria-hidden="true">
        <span className="shadow" />
        <span className="wrapper">
          <span className="liquids">
            <span className="liquid__shadow" />
            <span className="liquid__track" />
          </span>
        </span>
        <span className="cover" />
      </span>
    </button>
  )
}
