import { useCallback } from 'react'
import { useUserInfoStore } from '../stores/userInfoStore'
import { fetchPixivUserData } from '../utils/pixiv-api'
import { useLogger } from './useLogger'
import { db } from '../services/db'
import JSZip from 'jszip'
import type { DownloadMessage, DownloadResponse } from '../../../types/messages'
import { DownloadRequest, FileDownloadOptions, SqlGenerationOptions } from '@/types/service'
import { ETagDownloadMode } from '@/enums/ETagDownloadMode'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const REQUEST_DELAY = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useUserCrawler = () => {
  const { log, warn, error, success } = useLogger('artist')

  const startTask = useCallback(async () => {
    const { setTaskStatus } = useUserInfoStore.getState()

    if (useUserInfoStore.getState().isRunning) {
      warn('任务已在运行中')
      return
    }

    log('开始抓取用户信息任务...')

    const pendingItems = await db.users.where('status').equals('pending').toArray()

    if (pendingItems.length === 0) {
      log('所有用户已处理完成')
      return
    }

    setTaskStatus({ isRunning: true })
    log(`开始处理 ${pendingItems.length} 个用户`)

    for (const item of pendingItems) {
      const { uid } = item
      if (!useUserInfoStore.getState().isRunning) {
        warn('任务已暂停')
        break
      }

      await db.users.update(uid, { status: 'running', updatedAt: Date.now() })

      try {
        let retries = 0
        let data = null
        let _error: Error | null = null

        while (retries < MAX_RETRIES) {
          if (!useUserInfoStore.getState().isRunning) break

          try {
            data = await fetchPixivUserData(uid)
            break
          } catch (e: any) {
            if (e.message?.includes('404')) {
              _error = e
              break
            }

            if (e.message?.includes('429')) {
              warn(`触发速率限制(429)，等待 60 秒...`)
              await sleep(60000)
            } else {
              warn(`获取用户 ${uid} 失败 (重试 ${retries + 1}/${MAX_RETRIES}): ${e.message}`)
              await sleep(RETRY_DELAY)
            }
            retries++
          }
        }

        if (!useUserInfoStore.getState().isRunning) {
          await db.users.update(uid, { status: 'pending', updatedAt: Date.now() })
          warn('任务已暂停')
          break
        }

        if (data) {
          await db.users.update(uid, { status: 'fulfilled', data, updatedAt: Date.now() })
          success(`获取用户成功: ${data.name}`)
        } else {
          const _erroMsg = _error?.message || '获取失败或数据为空'
          await db.users.update(uid, { status: 'rejected', error: _erroMsg, updatedAt: Date.now() })
          error(`获取用户失败: ${uid} ${_erroMsg}`)
        }
      } catch (err: any) {
        await db.users.update(uid, { status: 'rejected', error: err.message, updatedAt: Date.now() })
        error(`处理用户出错 ${uid}: ${err.message}`)
      } finally {
        const delay = REQUEST_DELAY + Math.random() * 1000
        await sleep(delay)
      }
    }

    const wasRunning = useUserInfoStore.getState().isRunning
    setTaskStatus({ isRunning: false })

    if (wasRunning) {
      success('任务完成')
    }
  }, [log, warn, error, success])

  const stopTask = useCallback(() => {
    const { setTaskStatus } = useUserInfoStore.getState()
    setTaskStatus({ isRunning: false })
    warn('正在停止任务...')
  }, [warn])

  // --- 辅助函数 ---
  const downloadFile = async (content: string | Blob, filename: string, mimeType: string, customDirectory?: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })

    if (customDirectory) {
      try {
        await new Promise<void>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            const message: DownloadMessage = {
              type: 'DOWNLOAD_FILE',
              data: { dataUrl, filename, customDirectory }
            }
            chrome.runtime.sendMessage(message, (response: DownloadResponse) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
              else if (response.success) resolve()
              else reject(new Error(response.error || '下载失败'))
            })
          }
          reader.onerror = () => reject(new Error('无法读取 Blob'))
          reader.readAsDataURL(blob)
        })
        return
      } catch (error) {
        console.warn('Background script 下载失败，回退默认:', error)
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const generateSql = async (options?: SqlGenerationOptions) => {
    try {
      log('正在准备生成 SQL 更新文件...')
      const successfulItems = await db.users.where('status').equals('fulfilled').toArray()
      const validData = successfulItems.filter((item) => item.data).map((item) => item.data!)

      if (validData.length === 0) {
        log('没有可供生成 SQL 的成功数据。')
        return { success: true, data: '' }
      }

      const escapeSql = (str: string | null | undefined): string => {
        if (str === null || typeof str === 'undefined') return 'NULL'
        return `'${str.replace(/'/g, "''")}'`
      }

      let sqlStatements = [
        '-- Pixiv Artist 图片 URL 更新脚本',
        '-- 生成时间: ' + new Date().toISOString(),
        '-- 路径为压缩包内的相对路径',
        ''
      ]
      let updateCount = 0

      for (const user of validData) {
        if (user.avatarUrl || user.backgroundUrl) {
          const updates = []

          if (user.avatarUrl) {
            const extension = user.avatarUrl.split('.').pop()?.split('?')[0] || 'jpg'
            const localAvatarPath = `avatar.${extension}`
            updates.push(`"avatar" = ${escapeSql(localAvatarPath)}`)
          }

          const localBackgroundPath = user.backgroundUrl
            ? `background.${user.backgroundUrl.split('.').pop()?.split('?')[0] || 'jpg'}`
            : null
          updates.push(`"backgroundImg" = ${escapeSql(localBackgroundPath)}`)

          sqlStatements.push(`UPDATE "Artist" SET ${updates.join(', ')} WHERE "userId" = '${user.userId}';`)
          updateCount++
        }
      }

      if (updateCount === 0) {
        log('没有需要更新的用户数据。')
        return { success: true, data: '' }
      }

      const sqlContent = sqlStatements.join('\n')
      success(`SQL 文件生成成功，包含 ${updateCount} 条语句`)
      return { success: true, data: sqlContent }
    } catch (err: any) {
      error(`SQL生成失败: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  const downloadUserSqlFile = async (options?: SqlGenerationOptions & FileDownloadOptions) => {
    const result = await generateSql(options)
    if (result.success && result.data) {
      const filename = options?.filename || `pixiv_users_${new Date().toISOString().slice(0, 10)}.sql`
      await downloadFile(result.data, filename, 'text/sql')
      success('SQL文件下载成功')
    }
  }

  const downloadUserImages = async (request?: DownloadRequest) => {
    const { setDownloadProgress } = useUserInfoStore.getState()
    setDownloadProgress({ isDownloading: true, current: 0, total: 0 })

    try {
      const successfulItems = await db.users.where('status').equals('fulfilled').toArray()
      const usersWithImages = successfulItems
        .filter((item) => item.data && (item.data.avatarUrl || item.data.backgroundUrl))
        .map((item) => item.data!)

      if (usersWithImages.length === 0) {
        warn('没有找到带有图片的成功用户数据')
        return
      }

      setDownloadProgress({ total: usersWithImages.length })
      const downloadMode = request?.downloadMode || ETagDownloadMode.individual
      log(
        `开始${downloadMode === ETagDownloadMode.zip ? 'ZIP打包' : '单独'}下载 ${usersWithImages.length} 个用户的图片...`
      )

      const downloadSingleImage = async (imageUrl: string) => {
        // Pixiv images require Referer header, usually fetched via background script or specialized method
        // Here we reuse the canvas method if possible, or fetch directly if CORS allows (Pixiv usually doesn't without proxy/extension privs)
        // In extension context, fetch might work if host permissions are set.
        // Assuming fetch works or we use a helper. The previous service used fetch directly.
        try {
          const response = await fetch(imageUrl)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return await response.blob()
        } catch (e) {
          throw new Error(`Fetch failed: ${e}`)
        }
      }

      if (downloadMode === ETagDownloadMode.zip) {
        const zip = new JSZip()
        const rootFolder = zip.folder('artists')
        let count = 0

        for (const [index, user] of usersWithImages.entries()) {
          const userFolder = rootFolder!.folder(user.userId)
          let hasDownloaded = false

          try {
            if (user.avatarUrl) {
              try {
                const blob = await downloadSingleImage(user.avatarUrl)
                const ext = user.avatarUrl.split('.').pop()?.split('?')[0] || 'jpg'
                userFolder!.file(`avatar.${ext}`, blob)
                hasDownloaded = true
              } catch (e) {
                console.error(e)
              }
            }
            if (user.backgroundUrl) {
              try {
                const blob = await downloadSingleImage(user.backgroundUrl)
                const ext = user.backgroundUrl.split('.').pop()?.split('?')[0] || 'jpg'
                userFolder!.file(`background.${ext}`, blob)
                hasDownloaded = true
              } catch (e) {
                console.error(e)
              }
            }

            if (hasDownloaded) count++
            setDownloadProgress({ current: index + 1 })
            if (request?.onProgress) request.onProgress(index + 1, usersWithImages.length)
          } catch (e) {
            console.error(e)
          }
          await sleep(200)
        }

        if (count > 0) {
          log('正在生成ZIP...')
          const content = await zip.generateAsync({ type: 'blob' })
          await downloadFile(content, 'pixiv_user_images.zip', 'application/zip')
          success('ZIP下载完成')
        } else {
          error('所有图片下载失败')
        }
      } else {
        // Individual
        let count = 0
        for (const [index, user] of usersWithImages.entries()) {
          const userDirectory = `artists/${user.userId}`
          let hasDownloaded = false

          try {
            if (user.avatarUrl) {
              try {
                const blob = await downloadSingleImage(user.avatarUrl)
                const ext = user.avatarUrl.split('.').pop()?.split('?')[0] || 'jpg'
                await downloadFile(blob, `avatar.${ext}`, 'image/jpeg', userDirectory)
                hasDownloaded = true
              } catch (e) {
                console.error(e)
              }
            }
            if (user.backgroundUrl) {
              try {
                const blob = await downloadSingleImage(user.backgroundUrl)
                const ext = user.backgroundUrl.split('.').pop()?.split('?')[0] || 'jpg'
                await downloadFile(blob, `background.${ext}`, 'image/jpeg', userDirectory)
                hasDownloaded = true
              } catch (e) {
                console.error(e)
              }
            }

            if (hasDownloaded) count++
            setDownloadProgress({ current: index + 1 })
            if (request?.onProgress) request.onProgress(index + 1, usersWithImages.length)
          } catch (e) {
            console.error(e)
          }
          await sleep(200)
        }
        success(`成功下载 ${count} 个用户的图片`)
      }
    } catch (err: any) {
      error(`图片下载失败: ${err.message}`)
    } finally {
      setDownloadProgress({ isDownloading: false })
    }
  }

  return {
    startTask,
    stopTask,
    downloadUserSqlFile,
    downloadUserImages
  }
}
