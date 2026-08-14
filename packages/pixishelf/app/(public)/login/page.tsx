import React, { Suspense } from 'react'
import { Metadata } from 'next'
import PLogo from '@/components/layout/p-logo'
import { AuthLoading } from './_components/auth-loading'
import { APP_VERSION } from '@/_config'
import { LoginForm } from './_components/login-form'
import { InitAdminForm } from './_components/init-admin-form'
import { hasUsers } from '@/lib/auth/init'

export const metadata: Metadata = {
  title: '登录 - PixiShelf',
  description: '登录 PixiShelf 个人画廊管理系统，探索和收藏你喜爱的艺术作品。',
  openGraph: {
    title: '登录 - PixiShelf',
    description: '你的个人数字画廊'
  }
}

export default async function LoginPage() {
  const needInit = !(await hasUsers())

  return (
    <div className="flex min-h-dvh w-full bg-background">
      <aside className="relative hidden w-[46%] min-w-[30rem] overflow-hidden bg-primary text-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-x-10 top-[20%] grid grid-cols-3 gap-3 opacity-20"
          aria-hidden="true"
        >
          <div className="aspect-[3/4] rounded-lg border border-primary-foreground/60 bg-primary-foreground/20" />
          <div className="mt-10 aspect-[4/5] rounded-lg border border-primary-foreground/60 bg-primary-foreground/10" />
          <div className="aspect-square rounded-lg border border-primary-foreground/60 bg-primary-foreground/25" />
          <div className="col-span-2 aspect-[16/7] rounded-lg border border-primary-foreground/60 bg-primary-foreground/15" />
          <div className="-mt-5 aspect-[3/4] rounded-lg border border-primary-foreground/60 bg-primary-foreground/10" />
        </div>

        <div className="relative z-10 flex min-h-dvh w-full flex-col justify-between p-10 xl:p-14">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-foreground/12">
              <PLogo className="size-6 text-primary-foreground" />
            </span>
            <span className="text-xl font-bold tracking-tight">PixiShelf</span>
          </div>

          <div className="max-w-md border-l border-primary-foreground/45 pl-6">
            <p className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">你的私人作品档案</p>
            <p className="mt-5 text-base leading-7 text-primary-foreground/78 xl:text-lg">
              整理本地收藏，保留作品脉络，并在属于自己的空间里继续浏览。
            </p>
          </div>

          <div className="flex items-center gap-3 text-sm text-primary-foreground/65">
            <span>© {new Date().getFullYear()} PixiShelf</span>
            <span aria-hidden="true">·</span>
            <span>{APP_VERSION}</span>
          </div>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col items-center justify-center px-5 py-24 sm:px-8 lg:p-12">
        <div className="absolute left-5 top-6 flex items-center gap-2.5 lg:hidden">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10">
            <PLogo className="size-5 text-primary" />
          </span>
          <span className="text-lg font-bold tracking-tight">PixiShelf</span>
        </div>

        <div className="w-full max-w-md">
          {needInit ? (
            <div className="mb-8">
              <p className="mb-2 text-sm font-medium text-primary">开始使用</p>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">初始化系统</h1>
              <p className="mt-3 text-muted-foreground">创建第一个管理员账户，建立你的作品档案。</p>
            </div>
          ) : (
            <div className="mb-8">
              <p className="mb-2 text-sm font-medium text-primary">个人作品库</p>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">欢迎回来</h1>
              <p className="mt-3 text-muted-foreground">登录后继续整理和浏览你的收藏。</p>
            </div>
          )}

          <Suspense fallback={<AuthLoading />}>{needInit ? <InitAdminForm /> : <LoginForm />}</Suspense>

          <div className="mt-10 text-center text-xs text-muted-foreground lg:hidden">
            © {new Date().getFullYear()} PixiShelf {APP_VERSION}
          </div>
        </div>
      </main>
    </div>
  )
}
