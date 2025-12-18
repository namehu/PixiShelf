import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface SCardProps extends Omit<React.ComponentProps<typeof Card>, 'title'> {
  /** 卡片标题 */
  title?: React.ReactNode
  /** 卡片描述 */
  description?: React.ReactNode
  /** * 顶部右侧的操作区 (Antd 风格命名)
   * 通常用于放置链接、关闭按钮或状态标签
   */
  extra?: React.ReactNode
  /** * 顶部右侧的操作区 (语义化命名)
   * 也就是 extra 的别名，如果两者都传，会同时显示
   */
  action?: React.ReactNode
  /** 底部区域 (例如：保存按钮) */
  footer?: React.ReactNode
  /** 内容是否有内边距 (默认 true, 有些列表需要 false) */
  contentPadding?: boolean
}

export function SCard({
  title,
  description,
  extra,
  action,
  footer,
  children,
  className,
  contentPadding = true,
  ...props
}: SCardProps) {
  // 合并 action 和 extra，因为它们都属于右上角区域
  // 如果两者都存在，我们加一个 gap 让它们并排显示
  const rightContent = (action || extra) && (
    <div className="flex items-center gap-2">
      {extra}
      {action}
    </div>
  )

  // 只要有 标题、描述 或者 右侧内容，就渲染 Header
  const showHeader = title || description || rightContent

  return (
    <Card className={className} {...props}>
      {showHeader && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}

          {/* 将合并后的内容放入 CardAction 插槽 */}
          {rightContent && <CardAction>{rightContent}</CardAction>}
        </CardHeader>
      )}

      {!!children && <CardContent className={cn(!contentPadding && 'p-0')}>{children}</CardContent>}

      {footer && <CardFooter className="bg-neutral-50/50 border-t">{footer}</CardFooter>}
    </Card>
  )
}
