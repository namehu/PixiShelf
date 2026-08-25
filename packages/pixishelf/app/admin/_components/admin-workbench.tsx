import type { ComponentProps, ReactNode } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils'

interface AdminWorkbenchProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  contentClassName?: string
}

export function AdminWorkbench({
  title,
  description,
  eyebrow = '管理中心',
  metadata,
  actions,
  children,
  className,
  contentClassName,
  ...props
}: AdminWorkbenchProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 px-4 py-6 sm:px-6 lg:px-8', className)} {...props}>
      <PageHeader title={title} description={description} eyebrow={eyebrow} metadata={metadata} actions={actions} />
      <div className={cn('min-w-0', contentClassName)}>{children}</div>
    </div>
  )
}

export function AdminSection({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('flex min-w-0 flex-col gap-4', className)} {...props} />
}

export function AdminSectionHeader({
  title,
  description,
  actions,
  className,
  ...props
}: Omit<ComponentProps<'header'>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header
      className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function AdminTableFrame({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="admin-table-frame"
      className={cn('min-w-0 overflow-x-auto rounded-lg border border-border bg-background', className)}
      {...props}
    />
  )
}

export function AdminMetric({
  label,
  value,
  description,
  icon,
  className,
  ...props
}: ComponentProps<'div'> & {
  label: ReactNode
  value: ReactNode
  description?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-2', className)} {...props}>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="font-utility mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
          {value}
        </div>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {icon ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-primary">{icon}</div>
      ) : null}
    </div>
  )
}
