'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ImageIcon, SlidersHorizontal } from 'lucide-react'
import { useArtworkQuickFilters } from '@/hooks/use-artwork-quick-filters'
import { useLongPress } from '@/hooks/use-long-press'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { describeSnapshot, snapshotHref } from '@/lib/artwork-query-snapshot'
import { cn } from '@/lib/utils'

export function ArtworkNavigationMenu({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const api = useArtworkQuickFilters(open)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const link = useRef<HTMLAnchorElement>(null)
  const active = pathname === '/artworks' || pathname.startsWith('/artworks/')
  const clearTimers = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }
  useEffect(() => {
    setOpen(false)
    clearTimers()
    return clearTimers
  }, [pathname, api.userId])
  function enter() {
    if (mobile) return
    clearTimers()
    if (!open) enterTimer.current = setTimeout(() => setOpen(true), 1000)
  }
  function leave() {
    if (mobile) return
    clearTimers()
    leaveTimer.current = setTimeout(() => setOpen(false), 200)
  }
  const longPress = useLongPress({ threshold: 500, onLongPress: () => setOpen(true) })
  const manage = () => {
    const next = new URLSearchParams(pathname === '/artworks' ? params.toString() : '')
    next.set('quickFilters', 'manage')
    router.push(`/artworks?${next.toString()}`)
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(value) => {
        clearTimers()
        setOpen(value)
      }}
      modal={false}
    >
      <div
        className={cn('relative', mobile ? 'flex min-w-0' : 'flex items-center')}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') enter()
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') leave()
        }}
      >
        <Link
          ref={link}
          href="/artworks"
          aria-current={active ? 'page' : undefined}
          aria-haspopup={mobile ? 'menu' : undefined}
          aria-expanded={mobile ? open : undefined}
          onKeyDown={(e) => {
            if (mobile && e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
            }
          }}
          {...(mobile
            ? {
                onTouchStart: longPress.onTouchStart,
                onTouchMove: longPress.onTouchMove,
                onTouchEnd: longPress.onTouchEnd,
                onTouchCancel: longPress.onTouchCancel,
                onClickCapture: longPress.onClickCapture,
                onContextMenu: longPress.onContextMenu
              }
            : {})}
          className={cn(
            mobile
              ? 'relative flex min-h-16 w-full select-none flex-col items-center justify-center gap-1 px-2 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 [-webkit-touch-callout:none]'
              : 'relative flex h-10 items-center gap-2 rounded-md py-2 pr-1 pl-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            active &&
              (mobile
                ? 'text-primary before:bg-brand-accent'
                : 'bg-accent text-accent-foreground after:absolute after:inset-x-3 after:-bottom-[0.8125rem] after:h-0.5 after:rounded-full after:bg-brand-accent')
          )}
        >
          <ImageIcon className={mobile ? 'size-5' : 'size-4'} aria-hidden="true" />
          <span>作品</span>
        </Link>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="作品快捷筛选"
            aria-hidden={mobile || undefined}
            tabIndex={mobile ? -1 : 0}
            className={mobile ? 'pointer-events-none absolute top-0 left-1/2 size-px opacity-0' : 'h-10 w-7'}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align={mobile ? 'center' : 'start'}
        side={mobile ? 'top' : 'bottom'}
        sideOffset={8}
        className="w-72 max-w-[calc(100vw-2rem)]"
        onPointerEnter={clearTimers}
        onPointerLeave={leave}
        onCloseAutoFocus={(event) => {
          if (mobile) {
            event.preventDefault()
            link.current?.focus()
          }
        }}
      >
        <DropdownMenuLabel>快捷筛选</DropdownMenuLabel>
        {api.loading ? (
          <div className="p-2">
            <Skeleton className="h-11 w-full" />
          </div>
        ) : api.error ? (
          <div role="alert" className="p-2 text-sm">
            <p>{api.error}</p>
            <Button variant="link" onClick={api.refresh}>
              重试
            </Button>
          </div>
        ) : (
          <DropdownMenuGroup>
            {api.navigation.ids
              .flatMap((id) => api.items.filter((item) => item.id === id))
              .map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="min-h-11 flex-col items-start gap-1"
                  disabled={!!item.invalidReferences.length}
                  onSelect={() => {
                    const url = new URL(snapshotHref(item.query), window.location.origin)
                    url.searchParams.set('quickApply', crypto.randomUUID())
                    router.push(url.pathname + url.search)
                    window.scrollTo({ top: 0, behavior: 'instant' })
                  }}
                >
                  <PrivacySensitiveText className="w-full truncate font-medium">{item.name}</PrivacySensitiveText>
                  <PrivacySensitiveText className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {item.invalidReferences.length ? '条件已失效，请在管理中修正' : describeSnapshot(item.query)}
                  </PrivacySensitiveText>
                </DropdownMenuItem>
              ))}
            {!api.navigation.ids.length && (
              <p className="px-2 py-4 text-sm text-muted-foreground">还没有加入导航的快捷筛选。</p>
            )}
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="min-h-11" onSelect={manage}>
            <SlidersHorizontal />
            管理快捷筛选
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
