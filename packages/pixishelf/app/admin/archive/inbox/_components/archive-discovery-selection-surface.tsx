'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ArchiveDiscoverySelectionSurface({
  itemId,
  title,
  checked,
  disabled,
  onToggle,
  className,
  children
}: {
  itemId: string
  title: string
  checked: boolean
  disabled: boolean
  onToggle: (checked: boolean) => void
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={`画廊 ${title}`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-discovery-item={itemId}
      data-state={checked ? 'selected' : undefined}
      className={cn(
        'relative bg-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        disabled ? 'cursor-default' : 'cursor-pointer hover:bg-muted/40',
        checked && 'bg-accent/50',
        className
      )}
      onClick={(event) => {
        if (disabled || (event.target as HTMLElement).closest('a, button, input')) return
        onToggle(!checked)
      }}
      onKeyDown={(event) => {
        if (disabled || event.target !== event.currentTarget || (event.key !== ' ' && event.key !== 'Enter')) return
        event.preventDefault()
        onToggle(!checked)
      }}
    >
      {children}
    </div>
  )
}
