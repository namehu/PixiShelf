import type { HTMLAttributes, ReactNode } from 'react'
import { ArchiveIcon, CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type PageStateVariant = 'empty' | 'error' | 'loading'

interface PageStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant: PageStateVariant
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
  headingLevel?: 'h1' | 'h2' | 'h3'
}

export function PageState({
  variant,
  title,
  description,
  action,
  icon,
  compact = false,
  headingLevel: Heading = 'h2',
  className,
  ...props
}: PageStateProps) {
  const media =
    variant === 'loading' ? (
      <Spinner className="size-5 text-primary" aria-label={typeof title === 'string' ? title : '正在加载'} />
    ) : (
      (icon ?? (variant === 'error' ? <CircleAlertIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />))
    )

  return (
    <Empty
      data-state={variant}
      aria-busy={variant === 'loading' ? true : undefined}
      className={cn('min-h-64 w-full', compact ? 'p-6 md:p-8' : 'p-8 md:p-12', className)}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">{media}</EmptyMedia>
        <EmptyTitle>
          <Heading>{title}</Heading>
        </EmptyTitle>
        {variant === 'error' && description ? (
          <Alert variant="destructive" className="mt-2 max-w-md text-left">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{description}</AlertDescription>
          </Alert>
        ) : (
          description && <EmptyDescription>{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && <EmptyContent className="sm:flex-row sm:justify-center">{action}</EmptyContent>}
    </Empty>
  )
}

export type { PageStateProps, PageStateVariant }
