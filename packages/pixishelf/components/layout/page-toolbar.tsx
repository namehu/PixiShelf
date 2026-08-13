import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PageContainer, type PageContainerSize } from './page-container'

interface PageToolbarProps {
  leading?: ReactNode
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  sticky?: boolean
  className?: string
  contentClassName?: string
  containerSize?: PageContainerSize
}

export default function PageToolbar({
  leading,
  title,
  children,
  actions,
  sticky = true,
  className,
  contentClassName,
  containerSize = 'standard'
}: PageToolbarProps) {
  return (
    <div
      className={cn(
        'w-full border-b border-border bg-background/92 backdrop-blur-xl',
        sticky && 'sticky top-0 z-50 lg:top-16 lg:z-40',
        className
      )}
    >
      <PageContainer
        size={containerSize}
        className={cn('flex min-h-14 items-center gap-2 sm:gap-3 lg:min-h-16', contentClassName)}
      >
        {leading && <div className="flex shrink-0 items-center">{leading}</div>}
        {title && <div className="min-w-0">{title}</div>}
        {children && <div className="min-w-0 flex-1">{children}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </PageContainer>
    </div>
  )
}
