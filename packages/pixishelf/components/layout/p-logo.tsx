import { FC, memo } from 'react'
import { Pyramid } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IPLogoProps {
  /**
   * 额外的类名，可用于设置颜色
   */
  className?: string
  /**
   * 组件大小
   * - 'small': w-5 h-5 (20px)
   * - 'default': w-10 h-10 (40px)
   * - 'large': w-16 h-16 (64px)
   * - number: 自定义像素大小
   */
  size?: 'small' | 'default' | 'large' | number
}

const Component: FC<IPLogoProps> = (props) => {
  const { className, size = 'default' } = props

  // 预定义尺寸映射
  const sizeMap = {
    small: 'w-5 h-5',
    default: 'w-10 h-10',
    large: 'w-16 h-16'
  }

  // 判断 size 类型
  const isCustomSize = typeof size === 'number'
  const sizeClass = !isCustomSize ? sizeMap[size as keyof typeof sizeMap] : ''

  return (
    <div
      className={cn('text-primary flex items-center justify-center', sizeClass, className)}
      style={isCustomSize ? { width: size, height: size } : undefined}
    >
      <Pyramid className="w-full h-full" />
    </div>
  )
}

const PLogo = memo(Component)
export default PLogo
