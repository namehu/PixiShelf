import * as React from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
  // CardAction, // 我们不再需要原始的 CardAction 组件，因为它带有 Grid 属性
} from '@/components/ui/card'
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
  // 1. 合并 action 和 extra
  const rightContent = (action || extra) && (
    <div className="flex items-center gap-2">
      {extra}
      {action}
    </div>
  )

  // 2. 判断是否需要显示 Header
  const showHeader = title || description || rightContent

  // 3. 动态计算对齐方式
  // 如果有描述(两行文字)，建议顶对齐(items-start)，否则按钮会跑偏
  // 如果只有标题(一行文字)，强制垂直居中(items-center)，这样最好看
  const alignClass = description ? 'items-start' : 'items-center'

  return (
    <Card className={className} {...props}>
      {showHeader && (
        <CardHeader
          // 核心优化：
          // 1. 强制使用 flex 覆盖默认的 grid
          // 2. space-y-0 去除默认可能的垂直间距
          // 3. justify-between 撑开左右
          className={cn('flex flex-row justify-between space-y-0 pb-4', alignClass)}
        >
          {/* 左侧：标题 + 描述 的容器 */}
          <div className="flex flex-col gap-1.5">
            {title && <CardTitle className="leading-none">{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>

          {/* 右侧：操作区容器 */}
          {/* shrink-0 防止右侧按钮被长标题挤扁，ml-4 保持最小间距 */}
          {rightContent && <div className="shrink-0 ml-4">{rightContent}</div>}
        </CardHeader>
      )}

      {/* 渲染内容区域 */}
      {/* 使用 !!children 确保 children 存在才渲染，避免空 div padding 问题 */}
      {!!children && <CardContent className={cn(!contentPadding && 'p-0')}>{children}</CardContent>}

      {/* 底部区域 */}
      {footer && <CardFooter className="bg-neutral-50/50 border-t p-4 flex items-center">{footer}</CardFooter>}
    </Card>
  )
}
