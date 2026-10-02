import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: ReactNode
  eyebrow?: string
  action?: ReactNode
  actionClassName?: string
}

export default function PageHeader({ title, description, icon, eyebrow, action, actionClassName = '' }: PageHeaderProps) {
  return (
    <header className="app-page-header mb-6 sm:mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-400">{eyebrow}</p>}
        <h1 className="flex items-center gap-3 text-[1.55rem] font-bold leading-tight tracking-[-0.035em] text-slate-100 sm:text-[1.9rem]">
          {icon && <span aria-hidden="true" className="app-page-icon shrink-0 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-6 sm:[&>svg]:w-6">{icon}</span>}
          <span>{title}</span>
        </h1>
        {description && <p className="mt-2 max-w-2xl text-[13px] leading-6 text-slate-400 sm:text-sm">{description}</p>}
      </div>
      {action && <div className={`w-full shrink-0 sm:w-auto ${actionClassName}`}>{action}</div>}
    </header>
  )
}
