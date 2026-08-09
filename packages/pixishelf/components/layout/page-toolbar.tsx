import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import MobileNavigationMenu from './mobile-navigation-menu'

interface PageToolbarProps {
  leading?: ReactNode
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  sticky?: boolean
  className?: string
  contentClassName?: string
}

export default function PageToolbar({
  leading,
  title,
  children,
  actions,
  sticky = true,
  className,
  contentClassName
}: PageToolbarProps) {
  return (
    <div
      className={cn(
        'w-full border-b border-slate-200/60 bg-white/85 backdrop-blur-xl',
        sticky && 'sticky top-0 z-50 lg:top-16 lg:z-40',
        className
      )}
    >
      <div
        className={cn(
          'mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:min-h-16 lg:px-8',
          contentClassName
        )}
      >
        {leading && <div className="flex shrink-0 items-center">{leading}</div>}
        {title && <div className="min-w-0">{title}</div>}
        {children && <div className="min-w-0 flex-1">{children}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        <MobileNavigationMenu />
      </div>
    </div>
  )
}
