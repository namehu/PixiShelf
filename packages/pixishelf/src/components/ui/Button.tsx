'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// Button 组件
// ============================================================================

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体 */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否为加载状态 */
  loading?: boolean
  /** 是否为全宽 */
  fullWidth?: boolean
  /** 子元素 */
  children: React.ReactNode
}

/**
 * 按钮组件
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseClasses = [
      'inline-flex',
      'items-center',
      'justify-center',
      'rounded-md',
      'font-medium',
      'transition-colors',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'disabled:pointer-events-none',
      'disabled:opacity-50',
    ]

    const variantClasses = {
      primary: [
        'bg-primary',
        'text-primary-foreground',
        'hover:bg-primary/90',
      ],
      secondary: [
        'bg-secondary',
        'text-secondary-foreground',
        'hover:bg-secondary/80',
      ],
      outline: [
        'border',
        'border-input',
        'bg-background',
        'hover:bg-accent',
        'hover:text-accent-foreground',
      ],
      ghost: [
        'hover:bg-accent',
        'hover:text-accent-foreground',
      ],
      destructive: [
        'bg-destructive',
        'text-destructive-foreground',
        'hover:bg-destructive/90',
      ],
    }

    const sizeClasses = {
      sm: ['h-9', 'px-3', 'text-sm'],
      md: ['h-10', 'px-4', 'py-2'],
      lg: ['h-11', 'px-8', 'text-lg'],
    }

    const widthClasses = fullWidth ? ['w-full'] : []

    const allClasses = [
      ...baseClasses,
      ...variantClasses[variant],
      ...sizeClasses[size],
      ...widthClasses,
    ]

    return (
      <button
        className={cn(allClasses, className)}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="mr-2 h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'