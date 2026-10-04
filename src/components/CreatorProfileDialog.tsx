import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import { useModalBack } from '../lib/useModalBack'

const creatorLinks = [
  { label: 'GitHub', href: 'https://github.com/ridhwansalim', brand: 'github', icon: 'M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.09.682-.217.682-.483 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.455-1.157-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.091-.647.35-1.087.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.684-.103-.253-.446-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.748-1.025 2.748-1.025.546 1.376.203 2.393.1 2.646.64.7 1.027 1.593 1.027 2.684 0 3.842-2.339 4.687-4.566 4.935.359.31.679.92.679 1.855 0 1.339-.012 2.42-.012 2.75 0 .268.18.578.688.48A10.003 10.003 0 0 0 22 12c0-5.523-4.477-10-10-10Z' },
  { label: 'Instagram', href: 'https://www.instagram.com/ridhwan_salim/', brand: 'instagram', icon: 'M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 2A3.8 3.8 0 0 0 4 7.8v8.4A3.8 3.8 0 0 0 7.8 20h8.4a3.8 3.8 0 0 0 3.8-3.8V7.8A3.8 3.8 0 0 0 16.2 4H7.8ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.25-3.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ridhwan-s/', brand: 'linkedin', icon: 'M5.2 3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM3.4 9h3.6v12H3.4V9Zm5.8 0h3.45v1.64h.05C13.18 9.7 14.28 8.8 16.3 8.8c3.7 0 4.3 2.43 4.3 5.59V21H17v-5.86c0-1.4-.03-3.2-1.95-3.2-1.96 0-2.26 1.53-2.26 3.1V21H9.2V9Z' },
  { label: 'Portfolio', href: 'https://ridhwansalim.github.io/Portfolio', brand: 'portfolio', icon: '' },
]

type DeviceOrientationPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/** Call from the logo's click handler so iOS can associate permission with a user gesture. */
export async function requestCreatorMotionPermission(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === 'undefined') return false
  const orientationApi = DeviceOrientationEvent as DeviceOrientationPermission
  if (typeof orientationApi.requestPermission !== 'function') return true
  try {
    return (await orientationApi.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export default function CreatorProfileDialog({ isOpen, onClose, motionEnabled = false, onRequestMotion }: { isOpen: boolean; onClose: () => void; motionEnabled?: boolean; onRequestMotion?: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [contrastMode, setContrastMode] = useState<'light-ink' | 'dark-ink'>('light-ink')

  useEffect(() => {
    const dialog = dialogRef.current
    const backdrop = backdropRef.current
    if (!isOpen || !dialog || !backdrop) return

    let frame = 0
    const luminance = (r: number, g: number, b: number) => {
      const linear = [r, g, b].map(value => {
        const channel = value / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const colorAt = (x: number, y: number) => {
      const previousDialogPointerEvents = dialog.style.pointerEvents
      const previousBackdropPointerEvents = backdrop.style.pointerEvents
      dialog.style.pointerEvents = 'none'
      backdrop.style.pointerEvents = 'none'
      const stack = document.elementsFromPoint(x, y)
      dialog.style.pointerEvents = previousDialogPointerEvents
      backdrop.style.pointerEvents = previousBackdropPointerEvents

      for (const element of stack) {
        if (dialog.contains(element) || backdrop.contains(element)) continue
        for (let node: Element | null = element; node; node = node.parentElement) {
          const background = getComputedStyle(node).backgroundColor
          const match = background.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
          if (!match) continue
          const alphaText = match[4]
          const alpha = alphaText ? (alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText)) : 1
          if (alpha < 0.08) continue
          return luminance(Number(match[1]), Number(match[2]), Number(match[3])) * alpha + 0.5 * (1 - alpha)
        }
      }
      const bodyColor = getComputedStyle(document.body).backgroundColor
      const match = bodyColor.match(/[\d.]+/g)
      return match?.length && Number.isFinite(Number(match[0]))
        ? luminance(Number(match[0]), Number(match[1]), Number(match[2]))
        : 0.5
    }

    const updateContrast = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bounds = dialog.getBoundingClientRect()
        const points = [
          [0.5, 0.08], [0.5, 0.32], [0.5, 0.56], [0.5, 0.82],
          [0.12, 0.5], [0.88, 0.5],
        ] as const
        const average = points.reduce((total, [x, y]) => total + colorAt(
          Math.max(0, Math.min(window.innerWidth - 1, bounds.left + bounds.width * x)),
          Math.max(0, Math.min(window.innerHeight - 1, bounds.top + bounds.height * y))
        ), 0) / points.length
        setContrastMode(average < 0.35 ? 'dark-ink' : 'light-ink')
      })
    }

    updateContrast()
    window.addEventListener('scroll', updateContrast, { capture: true, passive: true })
    window.addEventListener('resize', updateContrast, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateContrast, true)
      window.removeEventListener('resize', updateContrast)
      cancelAnimationFrame(frame)
    }
  }, [isOpen])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!isOpen || !dialog) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobileViewport = window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches
    let initialBeta: number | null = null
    let initialGamma: number | null = null
    let hasOrientation = false
    let raf = 0
    let currentX = 0
    let currentY = 0
    let targetX = 0
    let targetY = 0
    const maxTilt = 10
    const clamp = (value: number) => Math.max(-maxTilt, Math.min(maxTilt, value))
    const writeTilt = (rotateX: number, rotateY: number) => {
      dialog.style.setProperty('--tilt-x', `${rotateX}deg`)
      dialog.style.setProperty('--tilt-y', `${rotateY}deg`)
      dialog.style.setProperty('--glare-x', `${50 + (rotateY / maxTilt) * 35}%`)
      dialog.style.setProperty('--glare-y', `${50 - (rotateX / maxTilt) * 35}%`)
      // Keep the aliases used by older pointer styles in sync.
      dialog.style.setProperty('--glass-tilt-x', `${rotateX}deg`)
      dialog.style.setProperty('--glass-tilt-y', `${rotateY}deg`)
    }
    const animateTilt = () => {
      raf = 0
      currentX += (targetX - currentX) * 0.12
      currentY += (targetY - currentY) * 0.12
      if (Math.abs(targetX - currentX) < 0.01) currentX = targetX
      if (Math.abs(targetY - currentY) < 0.01) currentY = targetY
      writeTilt(currentX, currentY)
      if (currentX !== targetX || currentY !== targetY) raf = requestAnimationFrame(animateTilt)
    }
    const setTarget = (x: number, y: number) => {
      targetX = clamp(x)
      targetY = clamp(y)
      if (!raf) raf = requestAnimationFrame(animateTilt)
    }
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return
      if (initialBeta === null || initialGamma === null) {
        initialBeta = event.beta
        initialGamma = event.gamma
      }
      hasOrientation = true
      // Damp sensor movement so a 10° phone movement yields a subtle card response.
      setTarget(-(event.beta - initialBeta) * 0.45, (event.gamma - initialGamma) * 0.45)
    }
    const handlePointerDown = () => {
      if (!motionEnabled) onRequestMotion?.()
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (reduceMotion || hasOrientation) return
      const bounds = dialog.getBoundingClientRect()
      const x = (event.clientX - bounds.left) / bounds.width - 0.5
      const y = (event.clientY - bounds.top) / bounds.height - 0.5
      setTarget(-y * (event.pointerType === 'touch' ? 6 : 4), x * (event.pointerType === 'touch' ? 6 : 4))
    }
    const resetTilt = () => {
      if (hasOrientation) return
      setTarget(0, 0)
    }
    if (!reduceMotion && mobileViewport && motionEnabled && typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', handleOrientation, { passive: true })
    }
    dialog.addEventListener('pointerdown', handlePointerDown)
    dialog.addEventListener('pointermove', handlePointerMove)
    dialog.addEventListener('pointerleave', resetTilt)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
      dialog.removeEventListener('pointerdown', handlePointerDown)
      dialog.removeEventListener('pointermove', handlePointerMove)
      dialog.removeEventListener('pointerleave', resetTilt)
      if (raf) cancelAnimationFrame(raf)
      writeTilt(0, 0)
    }
  }, [isOpen, motionEnabled, onRequestMotion])

  useModalBack(isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
        ref={backdropRef}
        className="creator-profile-backdrop fixed inset-0 z-[80] grid place-items-center overflow-hidden p-2 sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialogRef}
        data-contrast={contrastMode}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-profile-title"
        className="creator-profile-glass glass-card relative grid h-[calc(100dvh-1rem)] max-h-[620px] w-full max-w-2xl grid-rows-[minmax(0,46%)_minmax(0,1fr)] overflow-hidden rounded-3xl text-[var(--ink)] sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:grid-rows-1 sm:grid-cols-[minmax(180px,0.8fr)_1.2fr]"
      >
        <button type="button" aria-label="Open full-size creator photo" onClick={() => window.dispatchEvent(new Event('creator-photo-open'))} className="creator-profile-photo group relative min-h-0 w-full cursor-zoom-in overflow-hidden border-0 bg-[var(--surface-dark)] p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white sm:h-full">
          <img
            src="/ridhwan-creator.jpg"
            alt="Ridhwan S., creator of RR Capital"
            className="absolute inset-0 h-full w-full object-cover object-[center_28%] sm:object-center"
          />
          <span aria-hidden="true" className="creator-photo-hint absolute right-2 top-2 z-[3] rounded-full px-2 py-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 sm:right-3 sm:top-3">Expand photo</span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent px-3 pb-3 pt-8 text-white sm:hidden">
            <span className="block text-xs font-medium uppercase tracking-[0.16em] text-white/75">Created by</span>
            <span className="mt-0.5 block text-lg font-semibold">Ridhwan S.</span>
          </span>
        </button>

        <div className="creator-profile-glass__content relative z-[1] flex min-h-0 flex-col p-3 sm:p-6">
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close creator profile"
            onClick={onClose}
            className="creator-profile-glass__control absolute right-2 top-2 rounded-full p-1.5 text-[var(--ink)] transition-colors hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] sm:right-3 sm:top-3"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pr-10">
            <p className="creator-profile-adaptive-copy text-[9px] font-semibold uppercase tracking-[0.18em] sm:text-[10px]">About RR Capital</p>
            <h2 id="creator-profile-title" className="creator-profile-adaptive-copy mt-1 text-xl font-semibold tracking-tight sm:text-3xl">Ridhwan S.</h2>
            <p className="creator-profile-adaptive-copy mt-0.5 text-xs sm:text-sm">BI &amp; E-commerce Analyst · Full-stack Developer</p>
          </div>

          <p className="creator-profile-adaptive-copy mt-2 text-xs leading-5 sm:mt-4 sm:text-sm sm:leading-6">
            RR Capital is a personal finance workspace shaped around everyday needs, built for use with family and friends.
          </p>

          <div className="mt-3 sm:mt-5">
            <p className="creator-profile-adaptive-copy mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] sm:mb-2 sm:text-[10px]">Find me online</p>
            <div className="grid grid-cols-2 gap-2">
              {creatorLinks.map(({ label, href, brand, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`creator-profile-glass__control creator-profile-social creator-profile-social--${brand} inline-flex min-h-9 items-center justify-between gap-1.5 rounded-lg border px-2 text-xs font-medium text-[var(--ink)] transition-colors sm:min-h-11 sm:rounded-xl sm:px-3 sm:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]`}
                >
                  <span className="inline-flex items-center gap-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="creator-profile-social__icon h-4 w-4" fill="currentColor">{icon ? <path d={icon} /> : <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2v6h-2zM14 18h2v2h-2z" /></>}</svg><span className="creator-profile-adaptive-copy">{label}</span></span>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
                </a>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-2 sm:pt-4">
            <p className="creator-profile-adaptive-copy text-[9px] uppercase tracking-[0.14em] sm:text-[10px]">RR Capital · Personal use</p>
          </div>
        </div>
      </section>
      <CreatorPhotoViewer />
    </div>
  )
}

function CreatorPhotoViewer() {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('creator-photo-open', show)
    return () => window.removeEventListener('creator-photo-open', show)
  }, [])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  if (!open) return null
  return (
    <div className="creator-photo-viewer fixed inset-0 z-[100] grid place-items-center p-4" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-label="Creator photo" className="relative max-h-[92dvh] max-w-[min(92vw,48rem)] overflow-hidden rounded-2xl">
        <button ref={closeRef} type="button" aria-label="Close creator photo" onClick={() => setOpen(false)} className="creator-profile-glass__control absolute right-3 top-3 z-10 rounded-full p-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><X className="h-4 w-4" /></button>
        <img src="/ridhwan-creator.jpg" alt="Ridhwan S., creator of RR Capital" className="max-h-[92dvh] w-auto max-w-[92vw] object-contain" />
      </div>
    </div>
  )
}
