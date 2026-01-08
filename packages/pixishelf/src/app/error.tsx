'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCcw, Home } from 'lucide-react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full text-center space-y-8"
      >
        {/* 插画区域 */}
        <div className="relative flex justify-center py-4">
          <motion.div
            initial={{ rotate: -5 }}
            animate={{ rotate: 5 }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatType: 'reverse',
              ease: 'easeInOut'
            }}
            className="bg-white p-8 rounded-[2rem] shadow-xl shadow-red-500/5 border border-red-50 relative z-10"
          >
            <AlertCircle className="w-24 h-24 text-red-500" strokeWidth={1.5} />
          </motion.div>
          {/* 背景光晕 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-red-500/10 rounded-full blur-3xl" />
        </div>

        {/* 文本区域 */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">哎呀，出错了</h1>
          <p className="text-gray-500 text-lg leading-relaxed px-4">
            页面加载遇到了一些问题
            <br />
            请尝试刷新页面或稍后再试
          </p>
          {error.digest && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-xs text-gray-400 font-mono bg-gray-100 py-1 px-3 rounded-full inline-block mt-2 select-all"
            >
              Error ID: {error.digest}
            </motion.p>
          )}
        </div>

        {/* 按钮区域 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
          <Button
            size="lg"
            onClick={reset}
            className="bg-[#0096fa] hover:bg-[#0085dd] text-white rounded-full px-8 shadow-blue-500/20 shadow-lg hover:shadow-blue-500/30 transition-all duration-300"
          >
            <RefreshCcw className="mr-2 w-4 h-4" />
            重试
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full border-gray-200 text-gray-600 hover:text-[#0096fa] hover:border-[#0096fa]/30 hover:bg-blue-50 transition-all duration-300"
          >
            <Link href="/dashboard">
              <Home className="mr-2 w-4 h-4" />
              返回首页
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
