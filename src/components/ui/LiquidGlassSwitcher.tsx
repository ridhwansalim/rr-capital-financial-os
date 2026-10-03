import { useLayoutEffect, useRef, type ReactNode } from 'react'

type LiquidGlassSwitcherProps = {
  activeKey: string
  label: string
  className?: string
  children: ReactNode
  as?: 'div' | 'nav'
}

function positionCap(container: HTMLElement, target: HTMLElement) {
  // Read layout geometry rather than getBoundingClientRect(): the latter
  // includes hover scale transforms and would leave the cap offset after a
  // pointer hovers an item while a route change is in flight.
  let x = 0
  let current: HTMLElement | null = target
  while (current && current !== container) {
    x += current.offsetLeft
    if (current.parentElement instanceof HTMLElement) x -= current.parentElement.scrollLeft
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null
  }
  // All switcher items should be positioned by the switcher (or an anchored
  // child such as desktop More). Keep a rendered-geometry fallback for custom
  // consumers that insert another containing block.
  if (current !== container) {
    const containerRect = container.getBoundingClientRect()
    x = target.getBoundingClientRect().left - containerRect.left - container.clientLeft
  }
  container.style.setProperty('--cap-x', `${x - 8}px`)
  container.style.setProperty('--cap-w', `${target.offsetWidth + 16}px`)
}

/** Sliding liquid-glass cap for existing navigation and selection controls. */
export default function LiquidGlassSwitcher({ activeKey, label, className = '', children, as = 'div' }: LiquidGlassSwitcherProps) {
  const containerRef = useRef<HTMLElement>(null)
  const activeKeyRef = useRef(activeKey)
  const previousIndexRef = useRef(-1)
  const hasPlacedCapRef = useRef(false)

  useLayoutEffect(() => {
    activeKeyRef.current = activeKey
    const container = containerRef.current
    if (!container) return

    const updateCap = (animate: boolean) => {
      const items = Array.from(container.querySelectorAll<HTMLElement>('[data-glass-key]'))
      const activeIndex = items.findIndex(item => item.dataset.glassKey === activeKeyRef.current)
      const target = items[activeIndex]
      if (!target) return

      const previousIndex = previousIndexRef.current
      if (previousIndex !== -1 && activeIndex !== previousIndex) {
        container.style.setProperty('--cap-origin', activeIndex > previousIndex ? 'left' : 'right')
      }
      positionCap(container, target)

      if (animate && hasPlacedCapRef.current && activeIndex !== previousIndex) {
        container.classList.remove('is-squishing')
        void container.offsetWidth
        container.classList.add('is-squishing')
      }
      previousIndexRef.current = activeIndex
      hasPlacedCapRef.current = true
      container.classList.add('is-ready')
    }

    updateCap(true)
  }, [activeKey])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    let mounted = true
    const updateCap = () => {
      const items = Array.from(container.querySelectorAll<HTMLElement>('[data-glass-key]'))
      const activeIndex = items.findIndex(item => item.dataset.glassKey === activeKeyRef.current)
      const target = items[activeIndex]
      if (!target) return
      positionCap(container, target)
      previousIndexRef.current = activeIndex
      hasPlacedCapRef.current = true
      container.classList.add('is-ready')
    }
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { if (mounted) updateCap() })
    }

    scheduleUpdate()
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(container)
    container.querySelectorAll<HTMLElement>('[data-glass-key]').forEach(item => observer.observe(item))
    window.addEventListener('resize', scheduleUpdate)
    container.addEventListener('scroll', scheduleUpdate, true)
    document.fonts?.ready.then(() => { if (mounted) scheduleUpdate() })
    const readyFrame = requestAnimationFrame(() => container.classList.add('is-ready'))

    return () => {
      mounted = false
      cancelAnimationFrame(frame)
      cancelAnimationFrame(readyFrame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      container.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [])

  const sharedProps = { className: `liquid-switcher ${className}`, 'aria-label': label }
  if (as === 'nav') return <nav ref={node => { containerRef.current = node }} {...sharedProps}>{children}</nav>
  return <div ref={node => { containerRef.current = node }} {...sharedProps} role="group">{children}</div>
}
