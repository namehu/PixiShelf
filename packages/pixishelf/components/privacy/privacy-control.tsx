'use client'

import { useId, useState } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { privacySession } from '@/lib/privacy-session'
import { cn } from '@/lib/utils'
import { usePrivacyStore } from '@/store/privacy-store'

export function PrivacyControl({
  mobile = false,
  compact = false,
  portalContainer
}: {
  mobile?: boolean
  compact?: boolean
  portalContainer?: HTMLElement | null
}) {
  const status = usePrivacyStore((state) => state.status)
  const remembered = usePrivacyStore((state) => state.remembered)
  const storageError = usePrivacyStore((state) => state.storageError)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const enabled = status === 'privacy'
  const ready = status === 'privacy' || status === 'direct'
  const Icon = enabled ? EyeOff : Eye
  const hasMemory = remembered !== null && remembered.expiresAt > Date.now()
  const label = enabled ? '关闭隐私模式' : '开启隐私模式'

  return (
    <div
      ref={setContainer}
      className={cn('pointer-events-auto flex shrink-0 items-center', mobile && 'w-full gap-1')}
    >
      <Button
        type="button"
        variant={enabled ? 'secondary' : 'ghost'}
        size={compact ? 'icon' : 'default'}
        className={cn(
          mobile ? 'h-12 min-w-0 flex-1 justify-start gap-3 px-3 text-muted-foreground' : 'h-11',
          mobile && enabled && 'text-secondary-foreground',
          compact && 'w-11'
        )}
        aria-label={label}
        aria-pressed={enabled}
        title={`${label}（本浏览器所有本站标签）`}
        disabled={!ready}
        onClick={() => privacySession.toggle()}
      >
        <Icon data-icon="inline-start" className={mobile ? 'size-5' : undefined} aria-hidden="true" />
        {mobile && (
          <>
            <span>隐私模式</span>
            <span className="ml-auto text-xs text-muted-foreground">{ready ? (enabled ? '已开启' : '已关闭') : '待选择'}</span>
          </>
        )}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(mobile ? 'h-12 w-11' : 'h-11 w-8')}
            aria-label="隐私记忆设置"
          >
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={portalContainer ?? container}
          align="end"
          side={mobile ? 'top' : 'bottom'}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="flex max-w-[calc(100vw-2rem)] flex-col gap-3"
        >
          <PopoverHeader>
            <PopoverTitle id={titleId}>浏览器隐私偏好</PopoverTitle>
            <PopoverDescription id={descriptionId}>
              开关对本浏览器所有本站标签生效，关闭后各标签会显示原始内容。
            </PopoverDescription>
          </PopoverHeader>
          <p className="text-sm" role="status">
            {ready ? (enabled ? '当前：隐私模式' : '当前：原始模式') : '进入浏览页面后选择模式'}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasMemory
              ? `记忆至 ${new Date(remembered.expiresAt).toLocaleString('zh-CN')}，切换模式不会延长到期时间。`
              : '仅本次访问有效；下次访问时重新询问。'}
          </p>
          {storageError && (
            <Alert>
              <AlertDescription>浏览器存储不可用，无法保证记住选择。</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!ready}
            onClick={() => {
              if (hasMemory) privacySession.forget()
              else privacySession.remember()
              setOpen(false)
            }}
          >
            {hasMemory ? '取消记忆，下次访问重新询问' : '记住当前选择 30 天'}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
