'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuthUser } from '@/components/auth'
import PLogo from '@/components/layout/p-logo'
import { usePrivacyStore } from '@/store/privacy-store'
import { privacySession } from '@/lib/privacy-session'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { isContentWarningPath } from './content-warning-routes'

const CONTENT_WARNING_PENDING = 'pending'
const CONTENT_WARNING_CLEAR = 'clear'
const PROTECTED_CONTENT_ID = 'content-warning-protected-content'

export function ContentWarningGate() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const user = useAuthUser()
  const status = usePrivacyStore((state) => state.status)
  const storageError = usePrivacyStore((state) => state.storageError)
  const [remember, setRemember] = useState(false)
  const privacyActionRef = useRef<HTMLButtonElement>(null)
  const eligible = Boolean(user) && isContentWarningPath(pathname)
  const blocked = eligible && (status === 'initializing' || status === 'pending')
  const open = eligible && status === 'pending'

  useLayoutEffect(
    () =>
      privacySession.start({
        get localStorage() {
          return window.localStorage
        },
        get sessionStorage() {
          return window.sessionStorage
        },
        addEventListener: window.addEventListener.bind(window),
        removeEventListener: window.removeEventListener.bind(window),
        createChannel: typeof BroadcastChannel === 'undefined' ? undefined : (name) => new BroadcastChannel(name)
      }),
    []
  )

  useLayoutEffect(() => {
    const url = new URL(window.location.href)
    const entries = url.searchParams.getAll('entry')
    const mode = entries[0]
    if (!user || entries.length !== 1 || (mode !== 'direct' && mode !== 'privacy')) return
    privacySession.enter(mode)
    url.searchParams.delete('entry')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [pathname, searchParams, user])

  useEffect(() => {
    if (storageError && !blocked) {
      toast.warning('浏览器存储不可用，当前选择仍有效，但无法保证刷新后或下次访问时记住。', {
        id: 'privacy-storage-unavailable'
      })
    }
  }, [storageError, blocked])

  useLayoutEffect(() => {
    // Apply masking before releasing the server-rendered blocker, including after RSC updates.
    document.documentElement.dataset.mediaPrivacy = status === 'direct' ? 'off' : 'on'
    document.documentElement.dataset.contentWarning = blocked ? CONTENT_WARNING_PENDING : CONTENT_WARNING_CLEAR
    const protectedContent = document.getElementById(PROTECTED_CONTENT_ID)

    if (protectedContent) {
      protectedContent.inert = blocked

      if (blocked) {
        protectedContent.setAttribute('aria-hidden', 'true')
      } else {
        protectedContent.removeAttribute('aria-hidden')
      }
    }
  })

  const confirmAccess = () => privacySession.choose('direct', remember)
  const enterWithPrivacyMode = () => privacySession.choose('privacy', remember)

  return (
    <AlertDialog open={open} onOpenChange={() => undefined}>
      <AlertDialogContent
        className="fixed inset-0 left-0 top-0 z-[2147483647] block h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto overscroll-contain rounded-none border-0 bg-background p-0 text-foreground shadow-none duration-300 sm:max-w-none motion-reduce:animate-none motion-reduce:transition-none"
        overlayClassName="z-[2147483646] bg-background motion-reduce:animate-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          privacyActionRef.current?.focus()
        }}
      >
        <div className="flex min-h-full w-full flex-col bg-background">
          <header className="border-b border-border bg-background/90 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:h-16 sm:px-6 lg:px-8" translate="no">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary shadow-surface">
                  <PLogo className="text-primary-foreground" size="small" />
                </span>
                <span className="text-lg font-bold tracking-tight text-foreground">PixiShelf</span>
              </div>
            </div>
          </header>

          <div className="flex flex-1 items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:py-12">
            <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background p-6 shadow-floating sm:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />

              <AlertDialogHeader className="gap-0 text-left sm:text-left">
                <AlertDialogTitle className="text-balance text-2xl font-bold tracking-tight text-foreground">
                  内容提示
                </AlertDialogTitle>
                <AlertDialogDescription className="mt-3 max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  继续即确认已成年。隐私模式会遮蔽媒体和敏感信息。
                </AlertDialogDescription>
              </AlertDialogHeader>

              {storageError ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>浏览器存储不可用，当前页面仍可继续，但无法记住选择。</AlertDescription>
                </Alert>
              ) : null}

              <Field orientation="horizontal" className="mt-5">
                <Checkbox
                  id="remember-privacy"
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                />
                <FieldLabel htmlFor="remember-privacy">记住本次选择，30 天内不再询问</FieldLabel>
              </Field>

              <AlertDialogFooter className="mt-6 flex flex-col gap-2 sm:flex-col">
                <AlertDialogAction
                  ref={privacyActionRef}
                  className="h-11 w-full touch-manipulation justify-center rounded-lg px-4 text-sm font-semibold shadow-surface transition-colors motion-reduce:transition-none"
                  onClick={enterWithPrivacyMode}
                >
                  <ShieldCheck data-icon="inline-start" aria-hidden="true" />
                  隐私模式进入
                </AlertDialogAction>
                <AlertDialogCancel
                  className="group h-11 w-full touch-manipulation justify-between rounded-lg px-4 text-sm font-semibold transition-colors motion-reduce:transition-none"
                  onClick={confirmAccess}
                >
                  原始模式进入
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </AlertDialogCancel>
              </AlertDialogFooter>
            </section>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
