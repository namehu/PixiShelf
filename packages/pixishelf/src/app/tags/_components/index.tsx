import { cn } from '@/lib/utils'
import React from 'react'

export const Tabs = ({ value, onValueChange, children }: any) => {
  return (
    <div className="w-full flex justify-center">
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { value, onValueChange })
        }
        return child
      })}
    </div>
  )
}

export const TabsList = ({ children, className, value, onValueChange }: any) => {
  return (
    <div className={cn('inline-flex items-center justify-center', className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { activeValue: value, onValueChange })
        }
        return child
      })}
    </div>
  )
}

export const TabsTrigger = ({ value, children, activeValue, onValueChange, className }: any) => {
  const isActive = value === activeValue
  return (
    <button
      onClick={() => onValueChange?.(value)}
      className={cn(
        'rounded-lg text-xs font-bold transition-all duration-200',
        isActive ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600',
        className
      )}
    >
      {children}
    </button>
  )
}
