import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, eyebrow, metadata, actions, className, ...props }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
      {...props}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <div className="font-utility mb-2 text-xs font-medium tracking-[0.08em] text-primary uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[1.375rem] leading-[1.875rem] font-semibold tracking-[-0.02em] text-foreground sm:text-2xl sm:leading-8">
          {title}
        </h1>
        {description && <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>}
        {metadata && <div className="font-utility mt-3 text-xs text-muted-foreground">{metadata}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
