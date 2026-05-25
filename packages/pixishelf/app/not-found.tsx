'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { FileQuestion, Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full text-center space-y-8"
      >
        {/* 插画区域 */}
        <div className="relative flex justify-center py-4">
          <motion.div
            animate={{
              y: [0, -12, 0],
              rotate: [0, 2, -2, 0]
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
            className="bg-white p-8 rounded-[2rem] shadow-xl shadow-blue-500/5 border border-blue-50 relative z-10"
          >
            <FileQuestion className="w-24 h-24 text-[#0096fa]" strokeWidth={1.5} />
          </motion.div>
          {/* 背景光晕 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[#0096fa]/10 rounded-full blur-3xl animate-pulse" />
        </div>

        {/* 文本区域 */}
        <div className="space-y-3">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">404 Not Found</h1>
          <p className="text-gray-500 text-lg leading-relaxed">
            抱歉，您访问的页面好像不存在
            <br />
            或者已经被移除了
          </p>
        </div>

        {/* 按钮区域 */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Button
            asChild
            size="lg"
            className="bg-[#0096fa] hover:bg-[#0085dd] text-white rounded-full px-8 shadow-blue-500/20 shadow-lg hover:shadow-blue-500/30 transition-all duration-300"
          >
            <Link href="/dashboard">
              <Home className="mr-2 w-4 h-4" />
              返回首页
            </Link>
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => window.history.back()}
            className="rounded-full border-gray-200 text-gray-600 hover:text-[#0096fa] hover:border-[#0096fa]/30 hover:bg-blue-50 transition-all duration-300"
          >
            <ArrowLeft className="mr-2 w-4 h-4" />
            返回上一页
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
