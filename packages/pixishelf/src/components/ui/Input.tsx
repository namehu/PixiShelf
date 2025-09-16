'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// Input 组件
// ============================================================================

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 输入框标签 */
  label?: string
  /** 错误信息 */
  error?: string | undefined
  /** 帮助文本 */
  helperText?: string
  /** 是否为全宽 */
  fullWidth?: boolean
  /** 左侧图标 */
  leftIcon?: React.ReactNode
  /** 右侧图标 */
  rightIcon?: React.ReactNode
}

/**
 * 输入框组件
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = 'text',
      label,
      error,
      helperText,
      fullWidth = false,
      leftIcon,
      rightIcon,
      disabled,
      ...props
    },
    ref
  ) => {
    const inputId = React.useId()
    const hasError = Boolean(error)

    const containerClasses = [
      'flex',
      'flex-col',
      'gap-1.5',
      fullWidth ? 'w-full' : 'w-auto',
    ]

    const inputWrapperClasses = [
      'relative',
      'flex',
      'items-center',
    ]

    const inputClasses = [
      'flex',
      'h-10',
      'w-full',
      'rounded-md',
      'border',
      'bg-background',
      'px-3',
      'py-2',
      'text-sm',
      'ring-offset-background',
      'file:border-0',
      'file:bg-transparent',
      'file:text-sm',
      'file:font-medium',
      'placeholder:text-muted-foreground',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed',
      'disabled:opacity-50',
    ]

    // 根据状态调整样式
    if (hasError) {
      inputClasses.push('border-destructive', 'focus-visible:ring-destructive')
    } else {
      inputClasses.push('border-input')
    }

    // 根据图标调整内边距
    if (leftIcon) {
      inputClasses.push('pl-10')
    }
    if (rightIcon) {
      inputClasses.push('pr-10')
    }

    const iconClasses = [
      'absolute',
      'top-1/2',
      'transform',
      '-translate-y-1/2',
      'text-muted-foreground',
      'pointer-events-none',
    ]

    const leftIconClasses = [...iconClasses, 'left-3']
    const rightIconClasses = [...iconClasses, 'right-3']

    return (
      <div className={cn(containerClasses)}>
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
              hasError && 'text-destructive'
            )}
          >
            {label}
          </label>
        )}
        
        <div className={cn(inputWrapperClasses)}>
          {leftIcon && (
            <div className={cn(leftIconClasses)}>
              {leftIcon}
            </div>
          )}
          
          <input
            id={inputId}
            type={type}
            className={cn(inputClasses, className)}
            ref={ref}
            disabled={disabled}
            {...props}
          />
          
          {rightIcon && (
            <div className={cn(rightIconClasses)}>
              {rightIcon}
            </div>
          )}
        </div>
        
        {(error || helperText) && (
          <div className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              <span className="text-muted-foreground">{helperText}</span>
            )}
          </div>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'