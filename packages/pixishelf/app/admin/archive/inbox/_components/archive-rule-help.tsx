'use client'

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Mouse hover and keyboard/touch activation share the same help. */
export function ArchiveRuleHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    []
  )
  const hover = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearClose()
    setOpen(true)
  }
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    clearClose()
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        clearClose()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={label}
          onPointerEnter={hover}
          onPointerLeave={leave}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={label}
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="max-w-[calc(100vw-1.5rem)] text-sm leading-relaxed"
        onPointerEnter={hover}
        onPointerLeave={leave}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
