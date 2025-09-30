import { useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui'

interface ArtistAvatarProps {
  /**
   * 艺术家ID
   */
  userId?: string | number | null
  /**
   * 艺术家名称
   */
  name?: string
  /**
   * 头像大小，默认12
   */
  size?: number
}
/**
 * Artist Avatar 组件，支持多格式图片和fallback
 * @param param0
 * @returns
 */
export function ArtistAvatar({ userId, name, size = 12 }: ArtistAvatarProps) {
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
    <Avatar className={`size-${size}`}>
      <AvatarImage
        src={userId ? `/artists/${userId}.${formats[currentFormat]}` : undefined}
        alt={name}
        onError={handleImageError}
      />
      <AvatarFallback
        className={`h-${size} w-${size} bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 text-2xl font-bold`}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
