import { NextRequest, NextResponse } from 'next/server'
import { ScanProgress, ScanResult } from '@/types'
import logger from '@/lib/logger'

/**
 * 测试扫描SSE流接口
 * GET /api/scan/test-stream
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === 'true'

    // 创建SSE响应
    const encoder = new TextEncoder()
    let cancelled = false

    const stream = new ReadableStream({
      start(controller) {
        // 发送SSE事件的辅助函数
        const sendEvent = (event: string, data: any) => {
          if (cancelled) return
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          logger.info({ event, ...data })
          controller.enqueue(encoder.encode(message))
        }

        // 生成随机延迟（0-5秒）
        const getRandomDelay = () => Math.floor(Math.random() * 5000)

        // 模拟扫描进度数据
        const mockProgressData: ScanProgress[] = [
          {
            phase: 'counting',
            message: '正在统计文件数量...',
            current: 0,
            total: 100,
            percentage: 0
          },
          {
            phase: 'scanning',
            message: '正在扫描文件...',
            current: 25,
            total: 100,
            percentage: 25,
            estimatedSecondsRemaining: 15
          },
          {
            phase: 'scanning',
            message: '正在处理图片...',
            current: 50,
            total: 100,
            percentage: 50,
            estimatedSecondsRemaining: 10
          },
          {
            phase: 'creating',
            message: '正在创建作品记录...',
            current: 75,
            total: 100,
            percentage: 75,
            estimatedSecondsRemaining: 5
          },
          {
            phase: 'cleanup',
            message: '正在清理临时文件...',
            current: 90,
            total: 100,
            percentage: 90,
            estimatedSecondsRemaining: 2
          },
          {
            phase: 'complete',
            message: '扫描完成',
            current: 100,
            total: 100,
            percentage: 100,
            estimatedSecondsRemaining: 0
          }
        ]

        // 模拟扫描结果
        const mockResult: ScanResult = {
          totalArtworks: 156,
          newArtists: 12,
          newTags: 34,
          skippedArtworks: 8,
          processingTime: 15420,
          newArtworks: 23,
          newImages: 45,
          removedArtworks: force ? 3 : 0,
          errors: []
        }

        // 开始模拟扫描
        const startMockScan = async () => {
          try {
            // 发送连接成功事件
            sendEvent('connection', { success: true, result: '连接成功。开始测试扫描' })

            // 逐步发送进度事件
            for (let i = 0; i < mockProgressData.length; i++) {
              if (cancelled) {
                sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
                return
              }

              // 随机延迟
              await new Promise(resolve => setTimeout(resolve, getRandomDelay()))
              
              if (cancelled) {
                sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
                return
              }

              sendEvent('progress', mockProgressData[i])
            }

            // 发送完成事件
            if (!cancelled) {
              sendEvent('complete', { success: true, result: mockResult })
            }
          } catch (error: any) {
            if (!cancelled) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              sendEvent('error', { success: false, error: errorMsg })
            }
          } finally {
            controller.close()
          }
        }

        // 启动模拟扫描
        setTimeout(() => {
          startMockScan()
        }, 100)
      },

      cancel() {
        // 设置取消标志
        cancelled = true
        logger.info('Test scan stream cancelled')
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    })
  } catch (error) {
    console.error('Failed to start test scan stream:', error)
    return NextResponse.json({ error: 'Failed to start test scan stream' }, { status: 500 })
  }
}

/**
 * 取消测试扫描接口
 * POST /api/scan/test-stream
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 这里可以实现取消逻辑，但由于SSE的特性，主要通过客户端关闭连接来实现
    logger.info('Test scan cancellation requested')
    return NextResponse.json({ success: true, message: 'Test scan cancellation requested' })
  } catch (error) {
    console.error('Failed to cancel test scan:', error)
    return NextResponse.json({ error: 'Failed to cancel test scan' }, { status: 500 })
  }
}