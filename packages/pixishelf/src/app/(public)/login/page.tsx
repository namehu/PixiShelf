import React, { Suspense } from 'react'
import { Metadata } from 'next'
import PLogo from '@/components/layout/p-logo'
import { AuthLoading } from './_components/auth-loading'
import { APP_VERSION } from '@/_config'
import { LoginForm } from './_components/login-form'

export const metadata: Metadata = {
  title: '登录 - PixiShelf',
  description: '登录 PixiShelf 个人画廊管理系统，探索和收藏你喜爱的艺术作品。',
  openGraph: {
    title: '登录 - PixiShelf',
    description: '你的个人数字画廊'
  }
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* 左侧：静态插画区域 */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[60%] relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 w-full h-full">
          <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-900 relative">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:24px_24px]" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-400/30 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl" />
          </div>
        </div>

        {/* 品牌信息 */}
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-12 text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
              <PLogo className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">PixiShelf</span>
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="text-5xl font-bold leading-tight">
              探索、收藏 <br />
              你喜爱的艺术作品
            </h1>
            <p className="text-lg text-blue-100/80 leading-relaxed">
              PixiShelf 是一个现代化的个人画廊管理系统，致力于为你提供最优质的艺术品浏览与收藏体验。
            </p>
          </div>

          <div className="flex items-center gap-4 text-sm text-blue-200/60">
            <span>© {new Date().getFullYear()} PixiShelf</span>
            <span>·</span>
            <span className="hover:text-white transition-colors">{APP_VERSION}</span>
          </div>
        </div>
      </div>

      {/* 右侧：交互区域 */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12 relative">
        {/* 移动端 Logo */}
        <div className="lg:hidden absolute top-8 left-8 flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <PLogo className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-lg">PixiShelf</span>
        </div>

        <div className="w-full max-w-[400px] space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">欢迎回来</h2>
            <p className="text-muted-foreground">请输入您的账户信息以继续</p>
          </div>

          <Suspense fallback={<AuthLoading />}>
            <LoginForm />
          </Suspense>

          {/* 底部版权 (移动端) */}
          <div className="lg:hidden text-center mt-8 text-xs text-muted-foreground/50">
            © {new Date().getFullYear()} PixiShelf {APP_VERSION}
          </div>
        </div>
      </div>
    </div>
  )
}
