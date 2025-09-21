import { NextRequest, NextResponse } from 'next/server'
import { getSettingService } from '@/lib/services/setting'
import { getAppStateService } from '@/lib/services/app-state'
import { getScannerService } from '@/lib/services/scanner'
import { ScanProgress, ScanResult } from '@/types'

/**
 * 扫描SSE流接口
 * GET /api/v1/scan/stream
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const settingService = getSettingService()
    const appStateService = getAppStateService()
    const scannerService = getScannerService()

    const scanPath = await settingService.getScanPath()
    if (!scanPath) {
      return NextResponse.json({ error: 'SCAN_PATH is not configured' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === 'true'

    // 检查是否已经在扫描
    const currentState = appStateService.getState()
    if (currentState.scanning) {
      return NextResponse.json({ error: 'Scan already in progress' }, { status: 409 })
    }

    // 创建SSE响应
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // 发送SSE事件的辅助函数
        const sendEvent = (event: string, data: any) => {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))
        }

        // 开始扫描
        appStateService.setScanning(true)
        appStateService.setProgressMessage('初始化…')

        // 使用真实的扫描服务
        const startScan = async () => {
          try {
            const result = await scannerService.scan({
              scanPath,
              forceUpdate: force,
              onProgress: (progress: ScanProgress) => {
                appStateService.setProgressMessage(progress?.message || null)
                if (appStateService.getState().cancelRequested) {
                  throw new Error('Scan cancelled')
                }
                sendEvent('progress', progress)
              }
            })

            sendEvent('complete', { success: true, result })
          } catch (error: any) {
            if (error?.message === 'Scan cancelled') {
              sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
            } else {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              sendEvent('error', { success: false, error: errorMsg })
            }
          } finally {
            appStateService.setScanning(false)
            controller.close()
          }
        }

        // 启动扫描
        sendEvent('connection', { success: true, result: '连接成功。开始扫描' })

        setTimeout(() => {
          startScan()
        }, 100)
      },

      cancel() {
        // 清理资源
        appStateService.setScanning(false)
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
    console.error('Failed to start scan stream:', error)

    return NextResponse.json({ error: 'Failed to start scan stream' }, { status: 500 })
  }
}
