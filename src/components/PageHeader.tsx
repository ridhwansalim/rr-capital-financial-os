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
    <header className="mb-6 sm:mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>}
        <h1 className="flex items-center gap-2.5 text-xl font-bold leading-tight tracking-tight text-slate-100 sm:text-2xl">
          {icon && <span aria-hidden="true" className="shrink-0 [&>svg]:h-5 [&>svg]:w-5 sm:[&>svg]:h-6 sm:[&>svg]:w-6">{icon}</span>}
          <span>{title}</span>
        </h1>
        {description && <p className="mt-1 text-sm leading-5 text-slate-400">{description}</p>}
      </div>
      {action && <div className={`w-full shrink-0 sm:w-auto ${actionClassName}`}>{action}</div>}
    </header>
  )
}
