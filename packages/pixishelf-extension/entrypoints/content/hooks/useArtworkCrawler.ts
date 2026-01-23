import { useCallback } from 'react'
import { useArtworkTaskStore } from '../stores/artworkTaskStore'
import { fetchPixivArtworkData } from '../utils/pixiv-api'
import { useLogger } from './useLogger'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const REQUEST_DELAY = 1500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useArtworkCrawler = () => {
  const { log, warn, error, success } = useLogger('artwork')

  const startTask = useCallback(async () => {
    const { queue, setTaskStatus, updateItem } = useArtworkTaskStore.getState()

    // 再次检查 store 中的状态
    if (useArtworkTaskStore.getState().isRunning) {
      warn('任务已在运行中')
      return
    }

    log('开始抓取作品信息任务...')

    // Filter pending
    // 注意：这里可以筛选 'pending' 甚至 'rejected' (如果支持自动重试失败任务)
    // 暂时只处理 pending
    const pendingItems = queue.filter((item) => item.status === 'pending')

    if (pendingItems.length === 0) {
      log('所有作品已处理完成')
      return
    }

    setTaskStatus({ isRunning: true })
    log(`开始处理 ${pendingItems.length} 个作品`)

    for (const item of pendingItems) {
      const { id } = item
      // Check if paused/stopped
      if (!useArtworkTaskStore.getState().isRunning) {
        warn('任务已暂停')
        break
      }

      // Set to running
      updateItem(id, { status: 'running' })

      try {
        let retries = 0
        let data = null
        let _error: Error | null = null

        while (retries < MAX_RETRIES) {
          if (!useArtworkTaskStore.getState().isRunning) break

          try {
            data = await fetchPixivArtworkData(id)
            break
          } catch (e: any) {
            // 404 错误不重试，直接抛出
            if (e.message?.includes('404')) {
              _error = e
              break
            }

            if (e.message?.includes('429')) {
              warn(`触发速率限制(429)，等待 5 秒...`)
              await sleep(5000)
            } else {
              warn(`获取作品 ${id} 失败 (重试 ${retries + 1}/${MAX_RETRIES}): ${e.message}`)
              await sleep(RETRY_DELAY)
            }
            retries++
          }
        }

        if (!useArtworkTaskStore.getState().isRunning) {
          // 如果被暂停，改回 pending 状态以便下次继续？或者保持 running 但实际上停止了？
          // 通常改为 pending 比较合理，或者保持 running 但 UI 显示暂停
          // 这里简单起见，如果没完成就还是 pending
          updateItem(id, { status: 'pending' })
          warn('任务已暂停')
          break
        }

        if (data) {
          updateItem(id, { status: 'fulfilled', data })
          success(`获取作品成功: ${data.title}`)
        } else {
          const _erroMsg = _error?.message || '获取失败或数据为空'
          updateItem(id, { status: 'rejected', error: _erroMsg })
          error(`获取作品失败: ${id} ${_erroMsg}`)
        }
      } catch (err: any) {
        updateItem(id, { status: 'rejected', error: err.message })
        error(`处理作品出错 ${id}: ${err.message}`)
      } finally {
        // No need to manually update task stats, it's computed automatically!
        // Random delay
        const delay = REQUEST_DELAY + Math.random() * 1000
        await sleep(delay)
      }
    }

    // 任务结束逻辑
    const wasRunning = useArtworkTaskStore.getState().isRunning
    setTaskStatus({ isRunning: false })

    if (wasRunning) {
      success('任务完成')
    }
  }, [log, warn, error, success])

  const stopTask = useCallback(() => {
    const { setTaskStatus } = useArtworkTaskStore.getState()
    setTaskStatus({ isRunning: false })
    warn('正在停止任务...')
  }, [warn])

  return {
    startTask,
    stopTask
  }
}
