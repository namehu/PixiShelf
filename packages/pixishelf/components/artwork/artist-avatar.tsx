'use client'

import { useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface ArtistAvatarProps {
  src?: string | null
  /**
   * 艺术家名称
   */
  name?: string
  /**
   * 头像大小，默认12
   */
  size?: number

  className?: string
}
/**
 * Artist Avatar 组件，支持多格式图片和fallback
 * @param param0
 * @returns
 */
export function ArtistAvatar({ src, name, size = 12, className }: ArtistAvatarProps) {
  const [currentFormat, setCurrentFormat] = useState(0)
  const formats = ['jpg', 'png', 'gif']

  const getInitials = (name?: string) => {
    if (!name) {
      return ''
    }
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleImageError = () => {
    if (currentFormat < formats.length - 1) {
      setCurrentFormat(currentFormat + 1)
    }
  }

  return (
    <Avatar className={cn(className)} style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem` }}>
      <AvatarImage
        src={src ?? undefined}
        alt={name}
        className="h-full w-full object-cover"
        onError={handleImageError}
      />
      <AvatarFallback className="flex h-full w-full items-center justify-center bg-accent text-sm font-semibold text-accent-foreground">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
