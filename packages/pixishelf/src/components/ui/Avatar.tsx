import React from 'react'
import { cn } from '@/lib/utils'

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function Avatar({ className, children, ...props }: AvatarProps) {
  return (
    <div className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)} {...props}>
      {children}
    </div>
  )
}

export interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
}

export const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, src, alt, ...props }, ref) => {
    return (
      <img
        ref={ref}
        className={cn('aspect-square h-full w-full object-cover', className)}
        src={src}
        alt={alt}
        {...props}
      />
    )
  }
)

AvatarImage.displayName = 'AvatarImage'

export interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)

AvatarFallback.displayName = 'AvatarFallback'
