'use client'

import React from 'react'
import { ScanResult, ScanProgress, LogEntry } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Play, Square, RotateCcw, ChevronDown, ChevronUp, Trash2, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'

// 工具函数：秒数转时间文本
function secondsToText(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * 测试SSE组件
 *
 * 功能：
 * - 测试SSE连接和数据流
 * - 模拟扫描进度显示
 * - 支持开始/取消操作
 * - 详细日志查看
 */
export default function TestSSE() {
  // 测试扫描相关状态
  const [testStreaming, setTestStreaming] = React.useState(false)
  const testStreamingRef = React.useRef(testStreaming)
  React.useEffect(() => {
    testStreamingRef.current = testStreaming
  }, [testStreaming])

  const [testProgress, setTestProgress] = React.useState<ScanProgress | null>(null)
  const [testResult, setTestResult] = React.useState<ScanResult | null>(null)
  const [testError, setTestError] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const testEsRef = React.useRef<EventSource | null>(null)

  // 详细日志相关状态
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false)
  const [autoScroll, setAutoScroll] = React.useState(true)
  const logsEndRef = React.useRef<HTMLDivElement>(null)

  // 添加日志条目的函数
  const addLogEntry = React.useCallback((type: LogEntry['type'], data: any, message: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      data,
      message
    }
    setLogs((prev) => [...prev, entry])
  }, [])

  // 自动滚动到底部
  React.useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // 计时器效果
  React.useEffect(() => {
    let timer: any
    if (testStreaming) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [testStreaming])

  // 开始测试SSE流
  const startTestStream = React.useCallback(
    (force?: boolean) => {
      // 若已存在连接，先关闭
      if (testEsRef.current) {
        try {
          testEsRef.current.close()
        } catch {}
        testEsRef.current = null
        addLogEntry('connection', null, '关闭已有的测试 SSE 连接')
      }

      setTestStreaming(true)
      setTestProgress(null)
      setTestResult(null)
      setTestError(null)
      setLogs([]) // 清空之前的日志

      const qs = new URLSearchParams()
      if (force) qs.set('force', 'true')
      const url = `/api/scan/test-stream${qs.toString() ? `?${qs.toString()}` : ''}`

      addLogEntry('connection', { url, force }, `开始连接测试SSE: ${url}`)

      const connectTestSSE = () => {
        const es = new EventSource(url)
        testEsRef.current = es

        es.onopen = () => {
          addLogEntry('connection', null, '测试SSE连接已建立')
        }

        es.addEventListener('connection', (event) => {
          const data = JSON.parse(event.data)
          addLogEntry('connection', data, data.result || '连接成功')
        })

        es.addEventListener('progress', (event) => {
          const data: ScanProgress = JSON.parse(event.data)
          setTestProgress(data)
          addLogEntry('progress', data, `${data.phase}: ${data.message}`)
        })

        es.addEventListener('complete', (event) => {
          const data = JSON.parse(event.data)
          setTestResult(data.result)
          setTestStreaming(false)
          addLogEntry('complete', data, '测试扫描完成')
          toast.success('测试扫描完成')
          es.close()
          testEsRef.current = null
        })

        es.addEventListener('error', (event) => {
          const data = JSON.parse(event.data)
          setTestError(data.error)
          setTestStreaming(false)
          addLogEntry('error', data, `测试扫描错误: ${data.error}`)
          toast.error(`测试扫描错误: ${data.error}`)
          es.close()
          testEsRef.current = null
        })

        es.addEventListener('cancelled', (event) => {
          const data = JSON.parse(event.data)
          setTestStreaming(false)
          addLogEntry('cancelled', data, '测试扫描已取消')
          toast.info('测试扫描已取消')
          es.close()
          testEsRef.current = null
        })

        es.onerror = (error) => {
          console.error('测试SSE连接错误:', error)
          setTestError('SSE连接错误')
          setTestStreaming(false)
          addLogEntry('error', error, 'SSE连接错误')
          toast.error('测试SSE连接错误')
          es.close()
          testEsRef.current = null
        }
      }

      connectTestSSE()
    },
    [addLogEntry]
  )

  // 停止测试SSE流
  const stopTestStream = React.useCallback(() => {
    if (testEsRef.current) {
      try {
        testEsRef.current.close()
        addLogEntry('connection', null, '手动关闭测试SSE连接')
      } catch (error) {
        console.error('关闭测试SSE连接时出错:', error)
      }
      testEsRef.current = null
    }
    setTestStreaming(false)
    toast.info('测试扫描已停止')
  }, [addLogEntry])

  // 清空日志
  const clearLogs = React.useCallback(() => {
    setLogs([])
  }, [])

  // 组件卸载时清理
  React.useEffect(() => {
    return () => {
      if (testEsRef.current) {
        try {
          testEsRef.current.close()
        } catch {}
      }
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* 测试SSE控制区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            测试SSE接口
          </CardTitle>
          <CardDescription>测试Server-Sent Events (SSE) 接口的连接和数据流，模拟扫描进度</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 控制按钮 */}
          <div className="flex gap-2">
            <Button onClick={() => startTestStream(false)} disabled={testStreaming} className="flex items-center gap-2">
              <Play className="h-4 w-4" />
              开始测试
            </Button>
            <Button
              onClick={() => startTestStream(true)}
              disabled={testStreaming}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              强制测试
            </Button>
            {testStreaming && (
              <Button onClick={stopTestStream} variant="destructive" className="flex items-center gap-2">
                <Square className="h-4 w-4" />
                取消
              </Button>
            )}
          </div>

          {/* 进度显示 */}
          {testProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{testProgress.phase}</Badge>
                  <span className="text-sm text-muted-foreground">{testProgress.message}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {testProgress.percentage?.toFixed(1)}%
                  {testProgress.estimatedSecondsRemaining && (
                    <span className="ml-2">剩余: {secondsToText(testProgress.estimatedSecondsRemaining)}</span>
                  )}
                </div>
              </div>
              <Progress value={testProgress.percentage || 0} className="w-full" />
            </div>
          )}

          {/* 状态显示 */}
          {testStreaming && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>运行时间: {secondsToText(elapsed)}</span>
              <Badge variant="secondary">测试中...</Badge>
            </div>
          )}

          {/* 错误显示 */}
          {testError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{testError}</p>
            </div>
          )}

          {/* 结果显示 */}
          {testResult && (
            <div className="p-4 bg-muted/50 rounded-md space-y-2">
              <h4 className="font-medium">测试结果</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">总作品:</span>
                  <span className="ml-2 font-medium">{testResult.totalArtworks}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">新作品:</span>
                  <span className="ml-2 font-medium">{testResult.newArtworks}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">新艺术家:</span>
                  <span className="ml-2 font-medium">{testResult.newArtists}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">处理时间:</span>
                  <span className="ml-2 font-medium">{(testResult.processingTime / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详细日志区域 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              详细日志
              <Badge variant="secondary">{logs.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center space-x-2">
                <Switch id="auto-scroll" checked={autoScroll} onCheckedChange={setAutoScroll} />
                <Label htmlFor="auto-scroll" className="text-sm">
                  自动滚动
                </Label>
              </div>
              <Button onClick={clearLogs} variant="outline" size="sm" className="flex items-center gap-1">
                <Trash2 className="h-3 w-3" />
                清空
              </Button>
              <Button
                onClick={() => setShowDetailedLogs(!showDetailedLogs)}
                variant="outline"
                size="sm"
                className="flex items-center gap-1"
              >
                {showDetailedLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showDetailedLogs ? '收起' : '展开'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {showDetailedLogs && (
          <CardContent>
            <ScrollArea className="h-64 w-full border rounded-md p-2">
              <div className="space-y-1">
                {logs.map((log, index) => (
                  <div key={index} className="text-xs font-mono">
                    <span className="text-muted-foreground">[{log.timestamp}]</span>
                    <Badge
                      variant={log.type === 'error' ? 'destructive' : log.type === 'complete' ? 'default' : 'secondary'}
                      className="mx-2 text-xs"
                    >
                      {log.type}
                    </Badge>
                    <span>{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </ScrollArea>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
