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
    const { artworkList, progressData, setTaskStatus, updateProgress, updateTaskStats } = useArtworkTaskStore.getState()

    // 再次检查 store 中的状态，防止外部直接修改导致不一致
    if (useArtworkTaskStore.getState().isRunning) {
      warn('任务已在运行中')
      return
    }

    // Filter pending
    const pendingIds = artworkList.filter((id) => {
      const progress = progressData[id]
      return !progress || progress.status !== 'fulfilled'
    })

    if (pendingIds.length === 0) {
      log('所有作品已处理完成')
      return
    }

    setTaskStatus({ isRunning: true })
    log(`开始处理 ${pendingIds.length} 个作品`)

    for (const id of pendingIds) {
      // Check if paused/stopped
      if (!useArtworkTaskStore.getState().isRunning) {
        warn('任务已暂停')
        break
      }

      try {
        let retries = 0
        let data = null

        while (retries < MAX_RETRIES) {
          if (!useArtworkTaskStore.getState().isRunning) break

          try {
            data = await fetchPixivArtworkData(id)
            break
          } catch (e: any) {
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
          warn('任务已暂停')
          break
        }

        if (data) {
          updateProgress(id, { status: 'fulfilled', data })
          success(`获取作品成功: ${data.title}`)
        } else {
          updateProgress(id, { status: 'rejected', data: '获取失败或数据为空' })
          error(`获取作品失败: ${id}`)
        }
      } catch (err: any) {
        updateProgress(id, { status: 'rejected', data: err.message })
        error(`处理作品出错 ${id}: ${err.message}`)
      } finally {
        updateTaskStats()
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
