import { useEffect, useRef } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import { useModalBack } from '../lib/useModalBack'

const creatorLinks = [
  { label: 'GitHub', href: 'https://github.com/ridhwansalim', brand: 'github', icon: 'M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.09.682-.217.682-.483 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.455-1.157-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.091-.647.35-1.087.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.684-.103-.253-.446-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.748-1.025 2.748-1.025.546 1.376.203 2.393.1 2.646.64.7 1.027 1.593 1.027 2.684 0 3.842-2.339 4.687-4.566 4.935.359.31.679.92.679 1.855 0 1.339-.012 2.42-.012 2.75 0 .268.18.578.688.48A10.003 10.003 0 0 0 22 12c0-5.523-4.477-10-10-10Z' },
  { label: 'Instagram', href: 'https://www.instagram.com/ridhwan_salim/', brand: 'instagram', icon: 'M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 2A3.8 3.8 0 0 0 4 7.8v8.4A3.8 3.8 0 0 0 7.8 20h8.4a3.8 3.8 0 0 0 3.8-3.8V7.8A3.8 3.8 0 0 0 16.2 4H7.8ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.25-3.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ridhwan-s/', brand: 'linkedin', icon: 'M5.2 3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM3.4 9h3.6v12H3.4V9Zm5.8 0h3.45v1.64h.05C13.18 9.7 14.28 8.8 16.3 8.8c3.7 0 4.3 2.43 4.3 5.59V21H17v-5.86c0-1.4-.03-3.2-1.95-3.2-1.96 0-2.26 1.53-2.26 3.1V21H9.2V9Z' },
  { label: 'Portfolio', href: 'https://ridhwansalim.github.io/Portfolio', brand: 'portfolio', icon: '' },
]

export default function CreatorProfileDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return

    const updateSurface = (clientX: number, clientY: number) => {
      const bounds = dialog.getBoundingClientRect()
      const x = (clientX - bounds.left) / bounds.width
      const y = (clientY - bounds.top) / bounds.height
      dialog.style.setProperty('--glass-x', `${Math.max(0, Math.min(1, x)) * 100}%`)
      dialog.style.setProperty('--glass-y', `${Math.max(0, Math.min(1, y)) * 100}%`)
      dialog.style.setProperty('--glass-tilt-x', `${(0.5 - y) * 2.4}deg`)
      dialog.style.setProperty('--glass-tilt-y', `${(x - 0.5) * 2.4}deg`)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      updateSurface(event.clientX, event.clientY)
    }
    const resetSurface = () => {
      dialog.style.setProperty('--glass-x', '50%')
      dialog.style.setProperty('--glass-y', '0%')
      dialog.style.setProperty('--glass-tilt-x', '0deg')
      dialog.style.setProperty('--glass-tilt-y', '0deg')
    }

    dialog.addEventListener('pointermove', handlePointerMove)
    dialog.addEventListener('pointerleave', resetSurface)
    return () => {
      dialog.removeEventListener('pointermove', handlePointerMove)
      dialog.removeEventListener('pointerleave', resetSurface)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
        className="creator-profile-backdrop fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-profile-title"
        className="creator-profile-glass glass-card relative grid max-h-[min(90dvh,46rem)] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-3xl text-[var(--ink)] sm:max-h-[85dvh] sm:grid-cols-[minmax(180px,0.8fr)_1.2fr] sm:overflow-hidden"
      >
        <div className="relative min-h-52 overflow-hidden bg-[var(--surface-dark)] sm:min-h-[390px]">
          <img
            src="/ridhwan-creator.jpg"
            alt="Ridhwan S., creator of RR Capital"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent px-5 pb-5 pt-14 text-white sm:hidden">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/75">Created by</p>
            <p className="mt-1 text-xl font-semibold">Ridhwan S.</p>
          </div>
        </div>

        <div className="creator-profile-glass__content relative z-[1] flex flex-col p-5 text-[var(--ink)] sm:p-7">
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close creator profile"
            onClick={onClose}
            className="creator-profile-glass__control absolute right-4 top-4 rounded-full p-2 text-[var(--ink)] transition-colors hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="pr-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-primary-active)]">About RR Capital</p>
            <h2 id="creator-profile-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Ridhwan S.</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">BI &amp; E-commerce Analyst · Full-stack Developer</p>
          </div>

          <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
            RR Capital is a personal finance workspace shaped around everyday needs, built for use with family and friends.
          </p>

          <div className="mt-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Find me online</p>
            <div className="grid grid-cols-2 gap-2">
              {creatorLinks.map(({ label, href, brand, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`creator-profile-glass__control creator-profile-social creator-profile-social--${brand} inline-flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-sm font-medium text-[var(--ink)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]`}
                >
                  <span className="inline-flex items-center gap-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="creator-profile-social__icon h-4 w-4" fill="currentColor">{icon ? <path d={icon} /> : <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2v6h-2zM14 18h2v2h-2z" /></>}</svg>{label}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--muted)]" />
                </a>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-6">
            <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">RR Capital · Personal use</p>
            <button
              type="button"
              onClick={onClose}
              className="creator-profile-glass__action min-h-11 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-active)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
            >
              Close profile
            </button>
          </div>
        </div>
      </section>
      </>
    </div>
  )
}
