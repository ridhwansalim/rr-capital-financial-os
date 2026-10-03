import { useEffect, useRef } from 'react'
import { ArrowUpRight, BriefcaseBusiness, Camera, Code2, X } from 'lucide-react'
import { useModalBack } from '../lib/useModalBack'

const creatorLinks = [
  { label: 'GitHub', href: 'https://github.com/ridhwansalim', icon: Code2 },
  { label: 'Instagram', href: 'https://www.instagram.com/ridhwan_salim/', icon: Camera },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ridhwan-s/', icon: BriefcaseBusiness },
  { label: 'Portfolio', href: 'https://ridhwansalim.github.io/Portfolio', icon: ArrowUpRight },
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

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-profile-title"
        className="creator-profile-glass relative grid max-h-[min(90dvh,46rem)] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-3xl shadow-2xl sm:max-h-[85dvh] sm:grid-cols-[minmax(180px,0.8fr)_1.2fr] sm:overflow-hidden"
      >
        <svg className="creator-profile-glass__filter" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <filter id="creator-glass-bend" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.003 0.007" numOctaves="1" result="turbulence" />
            <feGaussianBlur in="turbulence" stdDeviation="2" result="softMap" />
            <feDisplacementMap in="SourceGraphic" in2="softMap" scale="26" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <div className="creator-profile-glass__photo relative min-h-52 overflow-hidden bg-[var(--surface-dark)] sm:min-h-[390px]">
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

        <div className="creator-profile-glass__content relative flex flex-col p-5 text-[var(--ink)] sm:p-7">
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close creator profile"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-2 text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
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
              {creatorLinks.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand-primary)]/50 hover:bg-[var(--brand-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
                >
                  <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-[var(--brand-primary-active)]" />{label}</span>
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
              className="min-h-11 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
            >
              Close profile
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
