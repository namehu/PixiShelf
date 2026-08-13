import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  headingLevel?: 'h2' | 'h3'
}

export function SectionHeader({
  title,
  description,
  actions,
  headingLevel: Heading = 'h2',
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <header
      data-slot="section-header"
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}
      {...props}
    >
      <div className="min-w-0">
        <Heading className="text-lg leading-7 font-semibold tracking-[-0.015em] text-foreground">{title}</Heading>
        {description && <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
