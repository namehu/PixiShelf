import { useCallback } from 'react'
import { useArtworkTaskStore } from '../stores/artworkTaskStore'
import { fetchPixivArtworkData } from '../utils/pixiv-api'
import { useLogger } from './useLogger'
import { db } from '../services/db'
import { sleep } from '../utils/common'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const REQUEST_DELAY = 500

export const useArtworkCrawler = () => {
  const { log, warn, error, success } = useLogger('artwork')

  const startTask = useCallback(async () => {
    const { setTaskStatus } = useArtworkTaskStore.getState()

    // 再次检查 store 中的状态
    if (useArtworkTaskStore.getState().isRunning) {
      warn('任务已在运行中')
      return
    }

    log('开始抓取作品信息任务...')

    // 从 DB 获取 pending 任务
    const pendingItems = await db.tasks.where('status').equals('pending').toArray()

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
      await db.tasks.update(id, { status: 'running', updatedAt: Date.now() })

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
          // 如果被暂停，改回 pending 状态
          await db.tasks.update(id, { status: 'pending', updatedAt: Date.now() })
          warn('任务已暂停')
          break
        }

        if (data) {
          await db.tasks.update(id, { status: 'fulfilled', data, updatedAt: Date.now() })
          success(`获取作品成功: ${data.title}`)
        } else {
          const _erroMsg = _error?.message || '获取失败或数据为空'
          await db.tasks.update(id, { status: 'rejected', error: _erroMsg, updatedAt: Date.now() })
          error(`获取作品失败: ${id} ${_erroMsg}`)
        }
      } catch (err: any) {
        await db.tasks.update(id, { status: 'rejected', error: err.message, updatedAt: Date.now() })
        error(`处理作品出错 ${id}: ${err.message}`)
      } finally {
        const delay = REQUEST_DELAY + Math.random() * 500
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
