'use client'

import React, { useRef, useState, useMemo } from 'react'
import { Upload, X, FileText, Play } from 'lucide-react'
import { toast } from 'sonner'
import { SCard } from '@/components/shared/s-card' // 使用我们之前封装的 Shared Card
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea' // 记得使用 shadcn 的 Textarea
import { Badge } from '@/components/ui/badge'

interface ClientScanCardProps {
  /** 扫描路径是否配置 (用于控制禁用状态) */
  hasScanPath: boolean
  /** 是否正在扫描中 */
  isScanning: boolean
  /** 点击提交的回调，返回解析后的路径数组 */
  onScan: (paths: string[]) => void
  className?: string
}

export function ClientScanCard({ hasScanPath, isScanning, onScan, className }: ClientScanCardProps) {
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 实时计算行数（有效路径数）
  const validLinesCount = useMemo(() => {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean).length
  }, [text])

  // 处理文件上传
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 检查文件类型
    if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
      toast.error('请上传 .txt 文本文件')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      if (content) {
        setText(content)
        toast.success(`已导入文件 "${file.name}"`)

        // 重置 input value，允许重复上传同一个文件
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.onerror = () => toast.error('读取文件失败')
    reader.readAsText(file)
  }

  // 提交扫描
  const handleSubmit = () => {
    const paths = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (paths.length === 0) {
      toast.error('列表为空，请输入或导入路径')
      return
    }
    onScan(paths)
  }

  // 清空内容
  const handleClear = () => {
    setText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <SCard
      className={className}
      title={
        <div className="flex items-center gap-2">
          <span>客户端扫描</span>
          {validLinesCount > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              已就绪 {validLinesCount} 条
            </Badge>
          )}
        </div>
      }
      // 头部右侧放置主操作按钮
      extra={
        <Button onClick={handleSubmit} disabled={isScanning || !hasScanPath || validLinesCount === 0} size="sm">
          {isScanning ? (
            <>
              <span className="animate-spin mr-2">⏳</span> 进行中...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" /> 提交扫描
            </>
          )}
        </Button>
      }
    >
      <div className="space-y-3">
        {/* 工具栏区域 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 隐藏的文件上传 input */}
            <input type="file" ref={fileInputRef} className="hidden" accept=".txt" onChange={handleFileUpload} />

            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isScanning}
              className="h-8 border-dashed"
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              导入 TXT 文件
            </Button>

            <span className="text-xs text-neutral-400">支持按行分割的 .txt 文件</span>
          </div>

          {text && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={isScanning}
              className="h-8 text-neutral-500 hover:text-red-600"
            >
              <X className="mr-1 h-3.5 w-3.5" /> 清空
            </Button>
          )}
        </div>

        {/* 文本编辑区域 */}
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              '粘贴相对路径，一行一个\n例如：\n112349563/ー/137026182-meta.txt\n9645567/HALLOWEEN/136994763-meta.txt'
            }
            className="min-h-[200px] font-mono text-xs leading-relaxed resize-y pr-4"
            disabled={isScanning}
          />
          {/* 这里可以加一个小图标提示 */}
          <FileText className="absolute right-3 top-3 h-4 w-4 text-neutral-200 pointer-events-none" />
        </div>
      </div>
    </SCard>
  )
}
