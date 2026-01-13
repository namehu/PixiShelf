import {
  ServiceResult,
  TaskConfiguration,
  DEFAULT_TASK_CONFIG,
  ERROR_CODES,
  IUserInfoService,
  SqlGenerationOptions,
  FileDownloadOptions,
  DownloadRequest,
  TaskExecutionState
} from '../../../types/service'
import type { DownloadMessage, DownloadResponse } from '../../../types/messages'
import { PixivUserData, UserProgress, UserProgressStorage, UserStats, PixivUserApiResponse } from '../../../types/pixiv'
import { useUserInfoStore } from '../stores/userInfoStore'
import { ETagDownloadMode } from '@/enums/ETagDownloadMode'

export class UserInfoService implements IUserInfoService {
  private abortController: AbortController | null = null
  private config: TaskConfiguration = DEFAULT_TASK_CONFIG

  constructor(config?: Partial<TaskConfiguration>) {
    if (config) {
      this.config = { ...DEFAULT_TASK_CONFIG, ...config }
    }
  }

  get executionState(): TaskExecutionState {
    const state = useUserInfoStore.getState()
    return {
      isRunning: state.isRunning
    }
  }

  // 添加用户ID
  async addUserIds(userIds: string[]): Promise<ServiceResult<{ added: number; total: number }>> {
    try {
      if (!userIds || userIds.length === 0) {
        return {
          success: false,
          error: '用户ID列表不能为空',
          code: ERROR_CODES.INVALID_INPUT
        }
      }

      const userInfoStore = useUserInfoStore.getState()
      const existingUserIds = userInfoStore.getUserIdList()
      const newUserIds = userIds.filter((id) => !existingUserIds.includes(id))

      if (newUserIds.length > 0) {
        userInfoStore.addUserIdsArray(newUserIds)
      }

      return {
        success: true,
        data: { added: newUserIds.length, total: existingUserIds.length + newUserIds.length }
      }
    } catch (error) {
      console.error('添加用户ID失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '添加用户ID失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  // 处理用户信息
  async processUsers(userIds: string[]) {
    const userInfoStore = useUserInfoStore.getState()

    try {
      // 设置任务状态
      userInfoStore.setTaskStatus({ isRunning: true, isPaused: false })
      userInfoStore.addLog('开始处理用户信息...')

      // 创建新的 AbortController
      this.abortController = new AbortController()

      // 批量处理用户ID
      const batchSize = this.config.batchSize || 10
      const delay = { min: 1000, max: 3000 }

      for (let i = 0; i < userIds.length; i += batchSize) {
        // 检查是否被中止
        if (this.abortController.signal.aborted) {
          userInfoStore.addLog('任务已被中止')
          break
        }

        const batch = userIds.slice(i, i + batchSize)
        userInfoStore.addLog(
          `处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(userIds.length / batchSize)}: ${batch.length} 个用户`
        )

        // 并行处理批次中的用户
        const promises = batch.map((userId) => this.processUserId(userId))
        await Promise.allSettled(promises)

        // 批次间延迟
        if (i + batchSize < userIds.length) {
          const delayTime = Math.random() * (delay.max - delay.min) + delay.min
          userInfoStore.addLog(`等待 ${Math.round(delayTime / 1000)} 秒后处理下一批次...`)
          await this.delay(delay.min, delay.max)
        }
      }

      userInfoStore.addLog('用户信息处理完成')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '处理用户信息时发生未知错误'
      userInfoStore.addLog(`处理失败: ${errorMessage}`)
      console.error('处理用户信息失败:', error)
    } finally {
      // 重置任务状态
      userInfoStore.setTaskStatus({ isRunning: false, isPaused: false })
      this.abortController = null
    }
  }

  // 处理单个用户ID
  private async processUserId(userId: string): Promise<PixivUserData> {
    const userInfoStore = useUserInfoStore.getState()

    try {
      userInfoStore.addLog(`开始处理用户 ${userId}`)

      // 获取用户数据
      const userData = await this.fetchPixivUserData(userId)
      // 提取用户信息
      const userInfo: PixivUserData = {
        userId: userId,
        name: userData.name || '',
        avatarUrl: userData.avatarUrl || '',
        backgroundUrl: userData.backgroundUrl || ''
      }

      // 更新进度
      const progress: UserProgress = {
        status: 'fulfilled',
        data: userInfo
      }
      userInfoStore.updateProgress(userId, progress)

      userInfoStore.addLog(`用户 ${userId} 处理完成: ${userInfo.name}`)
      return userInfo
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '处理用户信息失败'
      userInfoStore.addLog(`用户 ${userId} 处理失败: ${errorMessage}`)

      // 更新失败进度
      const progress: UserProgress = {
        status: 'rejected',
        data: errorMessage
      }
      userInfoStore.updateProgress(userId, progress)

      throw error
    }
  }

  // 获取Pixiv用户数据
  private async fetchPixivUserData(userId: string): Promise<PixivUserApiResponse> {
    // [已更新] 使用您提供的带有 full=1 参数的 API 接口
    const apiUrl = `https://www.pixiv.net/ajax/user/${userId}?full=1&lang=zh`
    const response = await fetch(apiUrl, {
      headers: { accept: 'application/json' }
    })

    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429')
      error.name = 'RateLimitError'
      throw error
    }

    if (response.status === 404) {
      throw new Error(`用户 ID 不存在: ${userId}`)
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status}`)
    }

    const data = await response.json()

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`)
    }

    const body = data.body

    // [已更新] 提取头像和背景图，优先使用 imageBig，并考虑为空的情况
    const avatarUrl = body.imageBig || body.image || null
    const backgroundUrl = body.background?.url || null

    return {
      userId: body.userId,
      name: body.name,
      avatarUrl: avatarUrl,
      backgroundUrl: backgroundUrl
    }
  }

  // 生成用户SQL
  async generateUserSql(_options?: SqlGenerationOptions): Promise<ServiceResult<string>> {
    try {
      console.log('正在准备生成 SQL 更新文件...')

      const userInfoStore = useUserInfoStore.getState()
      const allProgress = userInfoStore.getProgress()
      const successfulItems = Object.values(allProgress).filter((p) => p.status === 'fulfilled' && p.data)

      if (successfulItems.length === 0) {
        console.log('没有可供生成 SQL 的成功数据。')
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

      for (const progress of successfulItems) {
        const user = progress.data as PixivUserData

        // 仅当至少有一个URL有效时才生成UPDATE语句
        if (user.avatarUrl || user.backgroundUrl) {
          const updates = []

          // 处理头像路径
          if (user.avatarUrl) {
            const extension = user.avatarUrl.split('.').pop()?.split('?')[0] || 'jpg'
            const localAvatarPath = `avatar.${extension}`
            updates.push(`"avatar" = ${escapeSql(localAvatarPath)}`)
          }

          // 处理背景图路径
          // 如果 backgroundUrl 存在，则构建路径；否则，其值为 null
          const localBackgroundPath = user.backgroundUrl
            ? `background.${user.backgroundUrl.split('.').pop()?.split('?')[0] || 'jpg'}`
            : null

          // 总是更新背景图字段，以便将没有背景的用户设置为 NULL
          updates.push(`"backgroundImg" = ${escapeSql(localBackgroundPath)}`)

          sqlStatements.push(`UPDATE "Artist" SET ${updates.join(', ')} WHERE "userId" = '${user.userId}';`)
        }
      }

      if (sqlStatements.length <= 4) {
        // 检查是否有有效语句被添加
        console.log('没有找到需要更新的用户数据。')
        return { success: true, data: '' }
      }

      const finalSql = sqlStatements.join('\n')
      console.log(`📜 SQL 文件已生成，包含 ${sqlStatements.length - 4} 条更新语句!`)
      return { success: true, data: finalSql }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成SQL失败'
      console.error('生成用户信息SQL失败:', error)
      return {
        success: false,
        error: errorMessage,
        code: ERROR_CODES.NO_DATA
      }
    }
  }

  // 下载用户SQL文件
  async downloadUserSqlFile(options?: SqlGenerationOptions & FileDownloadOptions): Promise<ServiceResult> {
    try {
      const sqlResult = await this.generateUserSql(options)
      if (!sqlResult.success || !sqlResult.data) {
        return sqlResult
      }

      const filename = options?.filename || `pixiv_users_${new Date().toISOString().slice(0, 10)}.sql`
      await this.downloadFile(sqlResult.data, filename, 'text/sql')

      return {
        success: true,
        data: `SQL文件已下载: ${filename}`
      }
    } catch (error) {
      console.error('下载用户SQL文件失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载用户SQL文件失败',
        code: ERROR_CODES.OPERATION_FAILED
      }
    }
  }

  // 下载用户图片
  async downloadUserImages(request?: DownloadRequest): Promise<ServiceResult> {
    try {
      const progress = useUserInfoStore.getState().getProgress()
      const successfulUsers = Object.entries(progress)
        .filter(([_, result]) => result.status === 'fulfilled' && typeof result.data === 'object')
        .map(([_, result]) => result.data as PixivUserData)

      if (successfulUsers.length === 0) {
        return {
          success: false,
          error: '没有成功的用户数据可下载图片',
          code: ERROR_CODES.NO_DATA
        }
      }

      const downloadMode = request?.downloadMode || ETagDownloadMode.individual

      if (downloadMode === ETagDownloadMode.zip) {
        return await this.downloadImagesAsZip(successfulUsers)
      }
      return await this.downloadImagesIndividually(successfulUsers)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载用户图片失败',
        code: ERROR_CODES.OPERATION_FAILED
      }
    }
  }

  // 下载图片为ZIP
  private async downloadImagesAsZip(users: PixivUserData[]): Promise<ServiceResult> {
    try {
      console.log(`发现 ${users.length} 个用户的数据。开始准备下载图片...`)

      // 动态导入JSZip
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const rootFolder = zip.folder('artists')
      let downloadCount = 0

      for (const user of users) {
        const userFolder = rootFolder!.folder(user.userId)
        let hasDownloadedImage = false

        try {
          // 下载头像
          if (user.avatarUrl) {
            try {
              const response = await fetch(user.avatarUrl)
              if (!response.ok) throw new Error(`Status: ${response.status}`)
              const blob = await response.blob()
              const extension = user.avatarUrl.split('.').pop()?.split('?')[0] || 'jpg'
              userFolder!.file(`avatar.${extension}`, blob)
              console.log(`✅ [${user.userId}] 头像下载成功。`)
              hasDownloadedImage = true
            } catch (error) {
              console.error(`❌ [${user.userId}] 头像下载失败:`, error instanceof Error ? error.message : error)
            }
            await this.delay(Math.floor(Math.random() * 1000) + 300)
          }

          // 下载背景图
          if (user.backgroundUrl) {
            try {
              const response = await fetch(user.backgroundUrl)
              if (!response.ok) throw new Error(`Status: ${response.status}`)
              const blob = await response.blob()
              const extension = user.backgroundUrl.split('.').pop()?.split('?')[0] || 'jpg'
              userFolder!.file(`background.${extension}`, blob)
              console.log(`✅ [${user.userId}] 背景图下载成功。`)
              hasDownloadedImage = true
            } catch (error) {
              console.error(`❌ [${user.userId}] 背景图下载失败:`, error instanceof Error ? error.message : error)
            }
            await this.delay(Math.floor(Math.random() * 1000) + 300)
          }

          if (hasDownloadedImage) downloadCount++
        } catch (error) {
          console.warn(`下载用户 ${user.userId} 图片失败:`, error)
        }
      }

      if (downloadCount === 0) {
        console.log('没有任何图片被成功下载，不生成 zip 文件。')
        return {
          success: false,
          error: '没有任何图片被成功下载',
          code: ERROR_CODES.NO_DATA
        }
      }

      console.log('正在生成 zip 文件，请稍候...')
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const filename = 'pixiv_user_images.zip'
      await this.downloadFile(zipBlob, filename, 'application/zip')

      console.log(`📦 ${filename} 下载已开始!`)
      return {
        success: true,
        data: `用户图片ZIP文件已下载: ${filename}`
      }
    } catch (error) {
      console.error('下载用户图片ZIP失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载用户图片ZIP失败',
        code: ERROR_CODES.OPERATION_FAILED
      }
    }
  }

  // 单独下载图片
  private async downloadImagesIndividually(users: PixivUserData[]): Promise<ServiceResult> {
    let successCount = 0
    let failCount = 0

    for (const user of users) {
      try {
        // 创建用户专属文件夹路径
        const userDirectory = `artists/${user.userId}`

        // 下载头像
        if (user.avatarUrl) {
          try {
            const extension = this.getImageExtension(user.avatarUrl)
            const avatarFilename = `avatar.${extension}`
            await this.downloadSingleImageToDirectory(user.avatarUrl, avatarFilename, userDirectory)
            console.log(`✅ [${user.userId}] 头像下载成功。`)
            successCount++
          } catch (error) {
            console.error(`❌ [${user.userId}] 头像下载失败:`, error instanceof Error ? error.message : error)
            failCount++
          }
          await this.delay(Math.floor(Math.random() * 1000) + 300)
        }

        // 下载背景图
        if (user.backgroundUrl) {
          try {
            const extension = this.getImageExtension(user.backgroundUrl)
            const backgroundFilename = `background.${extension}`
            await this.downloadSingleImageToDirectory(user.backgroundUrl, backgroundFilename, userDirectory)
            console.log(`✅ [${user.userId}] 背景图下载成功。`)
            successCount++
          } catch (error) {
            console.error(`❌ [${user.userId}] 背景图下载失败:`, error instanceof Error ? error.message : error)
            failCount++
          }
          await this.delay(Math.floor(Math.random() * 1000) + 300)
        }
      } catch (error) {
        console.warn(`下载用户 ${user.userId} 图片失败:`, error)
        failCount++
      }
    }

    return {
      success: true,
      data: `图片下载完成: 成功 ${successCount} 个，失败 ${failCount} 个`
    }
  }

  // 获取图片扩展名
  private getImageExtension(url: string): string {
    const match = url.match(/\.([^.?]+)(\?|$)/)
    return match ? match[1] : 'jpg'
  }

  // 获取图片Blob
  private async fetchImageBlob(url: string): Promise<Blob | null> {
    try {
      const response = await fetch(url, {
        headers: {
          Referer: 'https://www.pixiv.net/'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      return await response.blob()
    } catch (error) {
      console.error(`获取图片失败: ${url}`, error)
      return null
    }
  }

  // 下载单个图片到指定目录
  private async downloadSingleImageToDirectory(url: string, filename: string, directory: string): Promise<void> {
    const blob = await this.fetchImageBlob(url)
    if (blob) {
      await this.downloadWithBackgroundScript(blob, filename, directory)
    }
  }

  // 使用 Background Script 下载到指定文件夹
  private async downloadWithBackgroundScript(blob: Blob, filename: string, customDirectory: string): Promise<void> {
    // 1. 在 Content Script 中使用 FileReader 将 Blob 转换为 data:URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as string)
      }
      reader.onerror = () => {
        reject(new Error('无法读取 Blob 为 Data URL'))
      }
      reader.readAsDataURL(blob)
    })

    // 2. 发送消息到 background script，直接发送 dataUrl
    const message: DownloadMessage = {
      type: 'DOWNLOAD_FILE',
      data: {
        dataUrl,
        filename,
        customDirectory
      }
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: DownloadResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        if (response.success) {
          console.log(`✅ Content: ${response.message}`)
          resolve()
        } else {
          reject(new Error(response.error || '下载失败'))
        }
      })
    })
  }

  // 下载文件
  private async downloadFile(content: string | Blob, filename: string, mimeType: string): Promise<void> {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 延迟函数
  private async delay(min: number, max?: number): Promise<void> {
    const delayTime = Math.random() * ((max ?? min * 2) - min) + min
    return new Promise((resolve) => setTimeout(resolve, delayTime))
  }

  // 获取统计信息
  getStats(): UserStats {
    const userInfoStore = useUserInfoStore.getState()
    return userInfoStore.userStats
  }

  // 获取进度
  getProgress(): UserProgressStorage {
    const userInfoStore = useUserInfoStore.getState()
    return userInfoStore.getProgress()
  }

  // 检查任务是否运行中
  isTaskRunning(): boolean {
    const userInfoStore = useUserInfoStore.getState()
    return userInfoStore.isRunning
  }
}

// 导出单例实例
export const userInfoService = new UserInfoService()
