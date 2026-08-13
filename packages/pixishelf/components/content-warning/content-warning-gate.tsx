'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuthUser } from '@/components/auth'
import PLogo from '@/components/layout/p-logo'
import { useMediaPrivacyMode } from '@/components/user-setting'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { isContentWarningPath } from './content-warning-routes'

const CONTENT_WARNING_PENDING = 'pending'
const CONTENT_WARNING_CLEAR = 'clear'
const PROTECTED_CONTENT_ID = 'content-warning-protected-content'

export function ContentWarningGate() {
  const pathname = usePathname()
  const user = useAuthUser()
  const privacyMode = useMediaPrivacyMode()
  const eligible = Boolean(user) && isContentWarningPath(pathname)
  const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null)
  const confirmedForCurrentUser = Boolean(user) && confirmedUserId === user?.id
  const open = eligible && !privacyMode && !confirmedForCurrentUser

  useEffect(() => {
    if (!eligible) {
      setConfirmedUserId(null)
    }
  }, [eligible])

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
    if (user) {
      setConfirmedUserId(user.id)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={() => undefined}>
      <AlertDialogContent
        className="fixed inset-0 left-0 top-0 z-[2147483647] block h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto overscroll-contain rounded-none border-0 bg-slate-50 p-0 text-slate-950 shadow-none duration-300 sm:max-w-none motion-reduce:animate-none motion-reduce:transition-none"
        overlayClassName="z-[2147483646] bg-slate-50 motion-reduce:animate-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="flex min-h-full w-full flex-col bg-slate-50">
          <header className="border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:h-16 sm:px-6 lg:px-8" translate="no">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
                  <PLogo className="text-white" size="small" />
                </span>
                <span className="text-lg font-bold tracking-tight text-slate-900">PixiShelf</span>
              </div>
            </div>
          </header>

          <main className="flex flex-1 items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:py-12">
            <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
              <div
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600"
                aria-hidden="true"
              />

              <div className="mb-6 flex items-center gap-3">
                <span className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-blue-50 px-3 text-base font-bold text-blue-700">
                  18+
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">R18 内容提示</p>
                  <p className="mt-0.5 text-xs text-slate-500">确认年龄后即可继续</p>
                </div>
              </div>

              <AlertDialogHeader className="gap-0 text-left sm:text-left">
                <AlertDialogTitle className="text-balance text-2xl font-bold tracking-tight text-slate-950">
                  浏览前的小提示
                </AlertDialogTitle>
                <AlertDialogDescription className="mt-3 max-w-md text-pretty text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                  此区域可能包含仅适合成年人浏览的内容。继续访问即表示你已年满 18 岁，并了解相关内容可能具有敏感性。
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                当前媒体隐私模式已关闭，确认后作品将以原始状态显示。
              </div>

              <AlertDialogFooter className="mt-6 block">
                <AlertDialogAction
                  className="group h-11 w-full touch-manipulation justify-between rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
                  onClick={confirmAccess}
                >
                  我已年满 18 岁，继续访问
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </AlertDialogAction>
              </AlertDialogFooter>

              <p className="mt-3 text-center text-xs leading-5 text-slate-400">未满 18 岁时，请不要继续浏览此区域。</p>
            </section>
          </main>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
