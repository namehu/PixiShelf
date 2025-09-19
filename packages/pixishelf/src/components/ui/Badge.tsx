import React from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  children: React.ReactNode
}

const badgeVariants = {
  default: 'border-transparent bg-primary-600 text-white hover:bg-primary-700',
  secondary:
    'border-transparent bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700',
  destructive: 'border-transparent bg-red-600 text-white hover:bg-red-700',
  outline: 'text-neutral-950 dark:text-neutral-50 border-neutral-200 dark:border-neutral-800'
}

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 dark:focus:ring-neutral-300',
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
