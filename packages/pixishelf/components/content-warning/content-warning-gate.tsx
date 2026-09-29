'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { usePathname } from 'next/navigation'
import { updateUserSettingAction } from '@/actions/user-setting-action'
import { useAuthStore, useAuthUser } from '@/components/auth'
import PLogo from '@/components/layout/p-logo'
import { useMediaPrivacyMode, useUserSettingsStore } from '@/components/user-setting'
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
import { Spinner } from '@/components/ui/spinner'
import { isContentWarningPath } from './content-warning-routes'

const CONTENT_WARNING_PENDING = 'pending'
const CONTENT_WARNING_CLEAR = 'clear'
const PROTECTED_CONTENT_ID = 'content-warning-protected-content'

export function ContentWarningGate() {
  const pathname = usePathname()
  const user = useAuthUser()
  const privacyMode = useMediaPrivacyMode()
  const settingsOwnerUserId = useUserSettingsStore((state) => state.ownerUserId)
  const updateSettingLocallyForUser = useUserSettingsStore((state) => state.updateSettingLocallyForUser)
  const eligible = Boolean(user) && isContentWarningPath(pathname)
  const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const previousUserIdRef = useRef<string | null | undefined>(undefined)
  const privacyActionRef = useRef<HTMLButtonElement>(null)
  const confirmedForCurrentUser = Boolean(user) && confirmedUserId === user?.id
  const privacyModeForCurrentUser = Boolean(user) && settingsOwnerUserId === user?.id && privacyMode
  const open = eligible && !privacyModeForCurrentUser && !confirmedForCurrentUser
  const privacyRequestUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    const userId = user?.id ?? null

    if (previousUserIdRef.current !== undefined && previousUserIdRef.current !== userId) {
      setConfirmedUserId(null)
      setSaveError(null)
      privacyRequestUserIdRef.current = null
    }

    previousUserIdRef.current = userId
  }, [user?.id])

  const { execute: enablePrivacyMode, isExecuting } = useAction(updateUserSettingAction, {
    onError: ({ error }) => {
      const requestedUserId = privacyRequestUserIdRef.current
      privacyRequestUserIdRef.current = null
      if (!requestedUserId || useAuthStore.getState().user?.id !== requestedUserId) return

      setSaveError(error.validationErrors?.formErrors?.[0] || error.serverError || '开启隐私模式失败，请重试。')
    },
    onSuccess: () => {
      const requestedUserId = privacyRequestUserIdRef.current
      privacyRequestUserIdRef.current = null
      if (!requestedUserId || useAuthStore.getState().user?.id !== requestedUserId) return

      setSaveError(null)
      updateSettingLocallyForUser(requestedUserId, 'media_privacy_mode', true)
    }
  })

  useLayoutEffect(() => {
    document.documentElement.dataset.contentWarning = open ? CONTENT_WARNING_PENDING : CONTENT_WARNING_CLEAR
    const protectedContent = document.getElementById(PROTECTED_CONTENT_ID)

    if (protectedContent) {
      protectedContent.inert = open

      if (open) {
        protectedContent.setAttribute('aria-hidden', 'true')
      } else {
        protectedContent.removeAttribute('aria-hidden')
      }
    }
  })

  const confirmAccess = () => {
    if (isExecuting) return

    if (user) {
      setSaveError(null)
      setConfirmedUserId(user.id)
    }
  }

  const enterWithPrivacyMode = () => {
    if (!user || isExecuting) return

    setSaveError(null)
    privacyRequestUserIdRef.current = user.id
    enablePrivacyMode({
      settings: [{ key: 'media_privacy_mode', value: true, type: 'boolean' }]
    })
  }

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

              <div className="mb-6 flex items-center gap-3">
                <span className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-accent px-3 text-base font-bold text-primary">
                  18+
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">R18 内容提示</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">确认年龄后即可继续</p>
                </div>
              </div>

              <AlertDialogHeader className="gap-0 text-left sm:text-left">
                <AlertDialogTitle className="text-balance text-2xl font-bold tracking-tight text-foreground">
                  浏览前的小提示
                </AlertDialogTitle>
                <AlertDialogDescription className="mt-3 max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  此区域可能包含仅适合成年人浏览的内容。继续访问即表示你已年满 18 岁，并了解相关内容可能具有敏感性。
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="mt-5 rounded-lg bg-surface-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                当前隐私模式已关闭。你可以先开启隐私模式，以遮蔽全站媒体和敏感信息；也可以确认成年后以原始状态进入。
              </div>

              {saveError ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              ) : null}

              <AlertDialogFooter className="mt-6 flex flex-col gap-2 sm:flex-col">
                {isExecuting ? (
                  <span className="sr-only" role="status" aria-live="polite" aria-label="正在开启隐私模式">
                    正在开启隐私模式
                  </span>
                ) : null}
                <AlertDialogAction
                  ref={privacyActionRef}
                  className="h-11 w-full touch-manipulation justify-center rounded-lg px-4 text-sm font-semibold shadow-surface transition-colors motion-reduce:transition-none"
                  disabled={isExecuting}
                  onClick={enterWithPrivacyMode}
                >
                  {isExecuting ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <ShieldCheck data-icon="inline-start" aria-hidden="true" />}
                  开启隐私模式并进入
                </AlertDialogAction>
                <AlertDialogCancel
                  className="group h-11 w-full touch-manipulation justify-between rounded-lg px-4 text-sm font-semibold transition-colors motion-reduce:transition-none"
                  disabled={isExecuting}
                  onClick={confirmAccess}
                >
                  我已年满 18 岁，以原始状态进入
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </AlertDialogCancel>
              </AlertDialogFooter>

              <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
                未满 18 岁时，请不要继续浏览此区域。
              </p>
            </section>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
