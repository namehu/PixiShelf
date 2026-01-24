// oxlint-disable no-console
// oxlint-disable max-params
import { useCallback } from 'react'
import { useTagStore } from '../stores/tagStore'
import { fetchPixivTagData } from '../utils/pixiv-api'
import { useLogger } from './useLogger'
import { db } from '../services/db'
import JSZip from 'jszip'
import type { DownloadMessage, DownloadResponse } from '../../../types/messages'
import { DownloadRequest, FileDownloadOptions, SqlGenerationOptions } from '@/types/service'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const REQUEST_DELAY = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useTagCrawler = () => {
  const { log, warn, error, success } = useLogger('tag')

  const startTask = useCallback(async () => {
    const { setTaskStatus } = useTagStore.getState()

    if (useTagStore.getState().isRunning) {
      warn('任务已在运行中')
      return
    }

    log('开始抓取标签信息任务...')

    const pendingItems = await db.tags.where('status').equals('pending').toArray()

    if (pendingItems.length === 0) {
      log('所有标签已处理完成')
      return
    }

    setTaskStatus({ isRunning: true })
    log(`开始处理 ${pendingItems.length} 个标签`)

    for (const item of pendingItems) {
      const { name } = item
      if (!useTagStore.getState().isRunning) {
        warn('任务已暂停')
        break
      }

      await db.tags.update(name, { status: 'running', updatedAt: Date.now() })

      try {
        let retries = 0
        let data = null
        let _error: Error | null = null

        while (retries < MAX_RETRIES) {
          if (!useTagStore.getState().isRunning) break

          try {
            data = await fetchPixivTagData(name)
            break
          } catch (e: any) {
            if (e.message?.includes('404')) {
              _error = e
              break
            }

            if (e.message?.includes('429')) {
              warn(`触发速率限制(429)，等待 5 秒...`)
              await sleep(5000)
            } else {
              warn(`获取标签 ${name} 失败 (重试 ${retries + 1}/${MAX_RETRIES}): ${e.message}`)
              await sleep(RETRY_DELAY)
            }
            retries++
          }
        }

        if (!useTagStore.getState().isRunning) {
          await db.tags.update(name, { status: 'pending', updatedAt: Date.now() })
          warn('任务已暂停')
          break
        }

        if (data) {
          await db.tags.update(name, { status: 'fulfilled', data, updatedAt: Date.now() })
          success(`获取标签成功: ${data.originalTag}`)
        } else {
          const _erroMsg = _error?.message || '获取失败或数据为空'
          await db.tags.update(name, { status: 'rejected', error: _erroMsg, updatedAt: Date.now() })
          error(`获取标签失败: ${name} ${_erroMsg}`)
        }
      } catch (err: any) {
        await db.tags.update(name, { status: 'rejected', error: err.message, updatedAt: Date.now() })
        error(`处理标签出错 ${name}: ${err.message}`)
      } finally {
        const delay = REQUEST_DELAY + Math.random() * 500
        await sleep(delay)
      }
    }

    const wasRunning = useTagStore.getState().isRunning
    setTaskStatus({ isRunning: false })

    if (wasRunning) {
      success('任务完成')
    }
  }, [log, warn, error, success])

  const stopTask = useCallback(() => {
    const { setTaskStatus } = useTagStore.getState()
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
      const successfulItems = await db.tags.where('status').equals('fulfilled').toArray()
      const validData = successfulItems.filter((item) => item.data).map((item) => item.data!)

      if (validData.length === 0) {
        log('没有可供生成 SQL 的成功数据。')
        return { success: true, data: '' }
      }

      const uniqueTagData = new Map()
      for (const data of validData) {
        if (data.originalTag) uniqueTagData.set(data.originalTag, data)
      }

      const escapeSql = (str: string) => str.replace(/'/g, "''")
      let sqlStatements = ['-- Pixiv 标签数据更新脚本', '-- 生成时间: ' + new Date().toISOString(), '']
      let updateCount = 0

      for (const [, data] of uniqueTagData.entries()) {
        const setClauses = []
        const name = escapeSql(data.originalTag)

        if (!!data.translation || !!data.englishTranslation || !!data.abstract) {
          setClauses.push(`"translateType" = 'PIXIV'`)
        }
        if (data.translation) setClauses.push(`"name_zh" = '${escapeSql(data.translation)}'`)
        if (data.englishTranslation) setClauses.push(`"name_en" = '${escapeSql(data.englishTranslation)}'`)
        if (data.abstract) setClauses.push(`"abstract" = '${escapeSql(data.abstract)}'`)
        if (data.imageUrl) {
          const imageUrl = data.imageUrl.split('/').pop()
          setClauses.push(`"image" = '/${escapeSql(imageUrl!)}'`)
        }

        if (setClauses.length > 0) {
          sqlStatements.push(`UPDATE "Tag" SET ${setClauses.join(', ')} WHERE "name" = '${name}';`)
          updateCount++
        }
      }

      if (updateCount === 0) {
        log('没有需要更新的字段')
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

  const downloadSqlFile = async (options?: SqlGenerationOptions & FileDownloadOptions) => {
    const result = await generateSql(options)
    if (result.success && result.data) {
      const filename = options?.filename || 'pixiv_tags_update.sql'
      await downloadFile(result.data, filename, 'text/sql')
      success('SQL文件下载成功')
    }
  }

  const downloadTagImages = async (request?: DownloadRequest) => {
    const { setDownloadProgress } = useTagStore.getState()
    setDownloadProgress({ isDownloading: true, current: 0, total: 0 })

    try {
      const successfulItems = await db.tags.where('status').equals('fulfilled').toArray()
      const itemsWithImages = successfulItems
        .filter((item) => item.data && item.data.imageUrl)
        .map((item) => item.data!)

      if (itemsWithImages.length === 0) {
        warn('没有找到带有封面图的标签')
        return
      }

      setDownloadProgress({ total: itemsWithImages.length })
      const downloadMode = request?.downloadMode || 'zip'
      log(`开始${downloadMode === 'zip' ? 'ZIP打包' : '单独'}下载 ${itemsWithImages.length} 张图片...`)

      const downloadSingleImage = async (imageUrl: string) => {
        return new Promise<Blob>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            canvas.getContext('2d')?.drawImage(img, 0, 0)
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas error'))), 'image/jpeg', 0.95)
          }
          img.onerror = () => reject(new Error('Load failed'))
          img.src = imageUrl
        })
      }

      if (downloadMode === 'zip') {
        const zip = new JSZip()
        const folder = zip.folder('tags')
        let count = 0

        for (const [index, data] of itemsWithImages.entries()) {
          try {
            const blob = await downloadSingleImage(data.imageUrl!)
            const fileName = data.imageUrl!.split('/').pop()!.split('?')[0]
            folder!.file(fileName, blob)
            count++
            setDownloadProgress({ current: count })
            if (request?.onProgress) request.onProgress(count, itemsWithImages.length)
          } catch (e) {
            console.error(e)
          }
          await sleep(200)
        }

        if (count > 0) {
          log('正在生成ZIP...')
          const content = await zip.generateAsync({ type: 'blob' })
          await downloadFile(content, 'pixiv_tag_images.zip', 'application/zip')
          success('ZIP下载完成')
        } else {
          error('所有图片下载失败')
        }
      } else {
        // Individual
        let count = 0
        for (const [index, data] of itemsWithImages.entries()) {
          try {
            const blob = await downloadSingleImage(data.imageUrl!)
            const fileName = data.imageUrl!.split('/').pop()!.split('?')[0]
            await downloadFile(blob, fileName, 'image/jpeg', request?.customDirectory)
            count++
            setDownloadProgress({ current: count })
            if (request?.onProgress) request.onProgress(count, itemsWithImages.length)
          } catch (e) {
            console.error(e)
          }
          await sleep(200)
        }
        success(`成功下载 ${count} 张图片`)
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
    downloadSqlFile,
    downloadTagImages
  }
}
