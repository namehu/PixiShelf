import JSZip from 'jszip'
import {
  PixivTagData,
  TaskProgress,
  TaskStats,
  PixivApiResponse,
  ServiceResult,
  TaskExecutionState,
  TaskConfiguration,
  TranslationResponse,
  IPixivService,
  DEFAULT_TASK_CONFIG,
  ERROR_CODES,
  ServiceEventListener,
  DownloadRequest,
  SqlGenerationOptions,
  FileDownloadOptions
} from '../../types'
import type { DownloadMessage, DownloadResponse } from '../../types/messages'
import { useTaskStore } from '../stores/taskStore'

/**
 * Content Script中的Pixiv服务
 * 负责处理所有与Pixiv相关的业务逻辑
 * 实现IPixivService接口
 */
class ContentPixivService implements IPixivService {
  private abortController: AbortController | null = null
  private config: TaskConfiguration = DEFAULT_TASK_CONFIG
  private eventListeners: Map<string, Set<ServiceEventListener>> = new Map()

  get executionState(): TaskExecutionState {
    const state = useTaskStore.getState()
    return {
      isRunning: state.isRunning
    }
  }

  // 任务管理
  async startTask(tags: string[], config?: Partial<TaskConfiguration>): Promise<ServiceResult> {
    try {
      this.config = { ...DEFAULT_TASK_CONFIG, ...config }

      // 开始处理任务
      this.processTags(tags)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
        code: ERROR_CODES.NETWORK_ERROR
      }
    }
  }

  // 标签操作
  async addTags(tags: string[]): Promise<
    ServiceResult<{
      added: number
      total: number
    }>
  > {
    try {
      const taskStore = useTaskStore.getState()
      const existingTags = taskStore.getTagList()
      const newTags = tags.filter((tag) => !existingTags.includes(tag))

      if (newTags.length > 0) {
        taskStore.addTags(newTags)
      }

      return {
        success: true,
        data: { added: newTags.length, total: existingTags.length + newTags.length }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '添加标签失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  async removeTag(tag: string): Promise<ServiceResult> {
    try {
      const taskStore = useTaskStore.getState()
      taskStore.removeTag(tag)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除标签失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  async clearTags(): Promise<ServiceResult> {
    try {
      const taskStore = useTaskStore.getState()
      taskStore.clearAll()

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '清空标签失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  async getTags(): Promise<string[]> {
    const taskStore = useTaskStore.getState()
    return taskStore.getTagList()
  }

  // 翻译功能
  async translateTag(tag: string): Promise<TranslationResponse> {
    try {
      const response = await this.fetchPixivTagData(tag)

      if (response.error) {
        return {
          tag,
          translation: null,
          englishTranslation: null,
          abstract: null,
          imageUrl: null,
          success: false,
          error: response.message || '翻译失败'
        }
      }

      const tagTranslation = response.body?.tagTranslation?.[tag]
      const pixpedia = response.body?.pixpedia

      return {
        tag,
        translation: tagTranslation?.zh || null,
        englishTranslation: tagTranslation?.en || null,
        abstract: pixpedia?.abstract || null,
        imageUrl: pixpedia?.image || null,
        success: true
      }
    } catch (error) {
      return {
        tag,
        translation: null,
        englishTranslation: null,
        abstract: null,
        imageUrl: null,
        success: false,
        error: error instanceof Error ? error.message : '网络错误'
      }
    }
  }

  // 数据导出
  async generateSql(_options?: SqlGenerationOptions): Promise<ServiceResult<string>> {
    try {
      console.log('正在准备生成 SQL 更新文件...')

      const taskStore = useTaskStore.getState()
      const allProgress = taskStore.getProgress()
      const successfulItems = Object.values(allProgress).filter((p) => p.status === 'fulfilled' && p.data)

      if (successfulItems.length === 0) {
        console.log('没有可供生成 SQL 的成功数据。')
        return { success: true, data: '' }
      }

      // 使用 Map 确保每个标签只生成一条唯一的更新语句
      const uniqueTagData = new Map()
      for (const progress of successfulItems) {
        const data = progress.data as PixivTagData
        if (data.originalTag) {
          uniqueTagData.set(data.originalTag, data)
        }
      }

      if (uniqueTagData.size === 0) {
        console.log('没有找到有效的标签数据来生成SQL。')
        return { success: true, data: '' }
      }

      const escapeSql = (str: string) => str.replace(/'/g, "''")
      let sqlStatements = ['-- Pixiv 标签数据更新脚本', '-- 生成时间: ' + new Date().toISOString(), '']
      let updateCount = 0

      for (const [, data] of uniqueTagData.entries()) {
        const setClauses = []
        const name = escapeSql(data.originalTag)

        // 动态构建 SET 子句
        if (!!data.translation || !!data.englishTranslation || !!data.abstract) {
          setClauses.push(`"translateType" = 'PIXIV'`) // 绑定翻译来源
        }
        if (data.translation) {
          setClauses.push(`"name_zh" = '${escapeSql(data.translation)}'`)
        }
        if (data.englishTranslation) {
          setClauses.push(`"name_en" = '${escapeSql(data.englishTranslation)}'`)
        }
        if (data.abstract) {
          setClauses.push(`"abstract" = '${escapeSql(data.abstract)}'`)
        }
        if (data.imageUrl) {
          const imageUrl = data.imageUrl.split('/').pop()
          setClauses.push(`"image" = '/${escapeSql(imageUrl!)}'`)
        }

        if (setClauses.length > 0) {
          const sql = `UPDATE "Tag" SET ${setClauses.join(', ')} WHERE "name" = '${name}';`
          sqlStatements.push(sql)
          updateCount++
        }
      }

      if (updateCount === 0) {
        console.log('没有需要更新的字段，不生成 SQL 文件。')
        return { success: true, data: '' }
      }

      const sqlContent = sqlStatements.join('\n')
      console.log(`📜 SQL 文件已生成! 包含 ${updateCount} 条更新语句。`)
      return { success: true, data: sqlContent }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SQL生成失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  async downloadSqlFile(options?: SqlGenerationOptions & FileDownloadOptions): Promise<ServiceResult> {
    try {
      const result = await this.generateSql(options)
      if (!result.success || !result.data) {
        return result
      }

      const filename = options?.filename || 'pixiv_tags_update.sql'
      await this.downloadFile(result.data, filename, 'text/sql')

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SQL文件下载失败',
        code: ERROR_CODES.DOWNLOAD_FAILED
      }
    }
  }

  // 图片下载
  async downloadTagImages(request?: DownloadRequest): Promise<ServiceResult> {
    try {
      const taskStore = useTaskStore.getState()
      const allProgress = taskStore.getProgress()
      const successfulItems = Object.values(allProgress).filter((p) => p.status === 'fulfilled' && p.data)

      if (successfulItems.length === 0) {
        return {
          success: false,
          error: '没有找到带有封面图的标签可供下载',
          code: ERROR_CODES.DOWNLOAD_FAILED
        }
      }

      // 过滤出有图片的标签
      const itemsWithImages = successfulItems.filter((item) => {
        const data = item.data as PixivTagData
        return data && data.imageUrl
      })

      if (itemsWithImages.length === 0) {
        return {
          success: false,
          error: '没有找到带有封面图的标签可供下载',
          code: ERROR_CODES.DOWNLOAD_FAILED
        }
      }

      // 获取下载模式，默认为zip模式以保持向后兼容
      const downloadMode = request?.downloadMode || 'zip'

      console.log(
        `发现 ${itemsWithImages.length} 个带封面图的标签。开始${downloadMode === 'zip' ? 'ZIP打包' : '单独'}下载...`
      )

      if (downloadMode === 'individual') {
        // 单独下载模式
        return await this.downloadImagesIndividually(itemsWithImages, request)
      } else {
        // ZIP打包下载模式（原有逻辑）
        return await this.downloadImagesAsZip(itemsWithImages, request)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '图片下载失败',
        code: ERROR_CODES.DOWNLOAD_FAILED
      }
    }
  }

  // 单独下载图片
  private async downloadImagesIndividually(itemsWithImages: any[], request?: DownloadRequest): Promise<ServiceResult> {
    let successCount = 0

    for (const [index, item] of itemsWithImages.entries()) {
      const data = item.data as PixivTagData

      try {
        const result = await this.downloadSingleImage(data.imageUrl!)

        if (result.success && result.arrayBuffer) {
          // 从URL中提取原始文件名
          const fileName = data.imageUrl!.split('/').pop()!.split('?')[0]

          // 创建Blob并下载
          const blob = new Blob([result.arrayBuffer], { type: result.mimeType || 'image/jpeg' })
          await this.downloadFile(blob, fileName, result.mimeType || 'image/jpeg', request?.customDirectory)

          successCount++
          const directoryInfo = request?.customDirectory ? ` 到 ${request.customDirectory}/` : ''
          console.log(
            `✅ (${successCount}/${itemsWithImages.length}) 成功下载标签 "${data.originalTag}" 的封面图${directoryInfo}: ${fileName}`
          )
        } else {
          console.error(`❌ 下载标签 "${data.originalTag}" 的封面图失败:`, result.error)
        }
      } catch (error) {
        console.error(
          `❌ 下载标签 "${data.originalTag}" 的封面图失败:`,
          error instanceof Error ? error.message : '未知错误'
        )
      }

      // 调用进度回调
      if (request?.onProgress) {
        request.onProgress(index + 1, itemsWithImages.length)
      }

      // 每次下载后随机延迟，避免对图片服务器造成太大压力
      await this.delay(200, 700)
    }

    if (successCount === 0) {
      console.log('所有封面图均下载失败。')
      return {
        success: false,
        error: '所有封面图均下载失败',
        code: ERROR_CODES.DOWNLOAD_FAILED
      }
    }

    const directoryInfo = request?.customDirectory ? ` 到 ${request.customDirectory}/ 目录` : ''
    console.log(`%c📁 成功下载 ${successCount} 个封面图文件${directoryInfo}!`, 'color: green; font-size: 14px;')
    return { success: true }
  }

  // ZIP打包下载图片（原有逻辑）
  private async downloadImagesAsZip(itemsWithImages: any[], request?: DownloadRequest): Promise<ServiceResult> {
    // 创建ZIP文件，与原始脚本一致的结构
    const zip = new JSZip()
    const rootFolder = zip.folder('tags')
    let successCount = 0

    for (const [index, item] of itemsWithImages.entries()) {
      const data = item.data as PixivTagData

      try {
        const result = await this.downloadSingleImage(data.imageUrl!)

        if (result.success && result.arrayBuffer) {
          // 从URL中提取文件名，与原始脚本一致
          const fileName = data.imageUrl!.split('/').pop()!.split('?')[0]
          rootFolder!.file(fileName, result.arrayBuffer)

          successCount++
          console.log(`✅ (${successCount}/${itemsWithImages.length}) 成功下载标签 "${data.originalTag}" 的封面图。`)
        } else {
          console.error(`❌ 下载标签 "${data.originalTag}" 的封面图失败:`, result.error)
        }
      } catch (error) {
        console.error(
          `❌ 下载标签 "${data.originalTag}" 的封面图失败:`,
          error instanceof Error ? error.message : '未知错误'
        )
      }

      // 调用进度回调
      if (request?.onProgress) {
        request.onProgress(index + 1, itemsWithImages.length)
      }

      // 每次下载后随机延迟，避免对图片服务器造成太大压力
      await this.delay(200, 700)
    }

    if (successCount === 0) {
      console.log('所有封面图均下载失败，不生成 zip 文件。')
      return {
        success: false,
        error: '所有封面图均下载失败',
        code: ERROR_CODES.DOWNLOAD_FAILED
      }
    }

    console.log(`正在生成 pixiv_tag_images.zip 文件，请稍候...`)
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    await this.downloadFile(zipBlob, 'pixiv_tag_images.zip', 'application/zip')

    console.log(`%c📦 pixiv_tag_images.zip 下载已开始!`, 'color: green; font-size: 14px;')
    return { success: true }
  }

  // 进度管理
  async getProgress(): Promise<TaskStats> {
    const taskStore = useTaskStore.getState()
    return taskStore.taskStats
  }

  async clearProgress(): Promise<ServiceResult> {
    try {
      const taskStore = useTaskStore.getState()
      taskStore.clearProgress()

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '清除进度失败',
        code: ERROR_CODES.STORAGE_ERROR
      }
    }
  }

  /**
   * 筛选失败的数据（与原始脚本的filterFailedData方法一致）
   * @param stringReg 正则表达式字符串，用于匹配错误信息
   * @param isDel 是否删除匹配的失败记录
   * @returns 匹配到的失败标签数组
   */
  async filterFailedData(stringReg?: string, isDel: boolean = false): Promise<string[]> {
    try {
      console.log(`正在筛选失败的数据... Regex: /${stringReg || ''}/, 删除: ${isDel}`)

      const taskStore = useTaskStore.getState()
      const progress = taskStore.getProgress()
      const failedTags: string[] = []
      let regex: RegExp | undefined

      try {
        if (stringReg) {
          regex = new RegExp(stringReg)
        }
      } catch (e) {
        console.error('❌ 无效的正则表达式:', e instanceof Error ? e.message : '未知错误')
        return []
      }

      for (const [tag, result] of Object.entries(progress)) {
        if (result.status === 'rejected') {
          // 确保 result.data 是字符串类型以避免 .test() 方法出错
          const errorMessage = typeof result.data === 'string' ? result.data : ''
          if (!stringReg || (regex && regex.test(errorMessage))) {
            failedTags.push(tag)
          }
        }
      }

      if (failedTags.length === 0) {
        console.log('没有找到匹配条件的失败数据。')
        return []
      }

      if (isDel) {
        console.log(`找到 ${failedTags.length} 个匹配项，准备删除...`)
        for (const tag of failedTags) {
          taskStore.removeTag(tag)
        }
        console.log(`✅ 已成功删除 ${failedTags.length} 条失败记录。`)
      } else {
        console.log(`✅ 找到 ${failedTags.length} 个匹配的失败标签:`, failedTags)
      }

      return failedTags
    } catch (error) {
      console.error('筛选失败数据时出错:', error)
      return []
    }
  }

  // 清理
  dispose(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.eventListeners.clear()
  }

  // 私有方法
  private async processTags(tags: string[]): Promise<void> {
    this.abortController = new AbortController()

    // 添加标签到 taskStore
    const taskStore = useTaskStore.getState()
    taskStore.addTags(tags)

    // 获取所有标签和当前进度
    const allTags = taskStore.getTagList()
    let progress = taskStore.getProgress()

    while (true) {
      if (this.abortController.signal.aborted) {
        break
      }

      if (!this.executionState.isRunning) {
        console.log('✅ 任务已应请求安全暂停。')
        return
      }

      const completedTags = new Set(Object.keys(progress))
      const pendingTags = allTags.filter((tag) => !completedTags.has(tag))

      if (pendingTags.length === 0) {
        console.log('✨ 所有标签均已处理完毕!')
        break
      }

      console.log(`总计: ${allTags.length}, 已完成: ${completedTags.size}, 待处理: ${pendingTags.length}`)

      const batch = pendingTags.slice(0, this.config.concurrentRequests)
      console.log(`--- 正在处理批次 (数量: ${batch.length}) ---`)

      const promises = batch.map((tag) =>
        this.processTagName(tag)
          .then((data) => ({ id: tag, status: 'fulfilled' as const, value: data }))
          .catch((error) => ({ id: tag, status: 'rejected' as const, reason: error }))
      )

      const results = await Promise.all(promises)

      // 检查是否有429错误
      const rateLimitResult = results.find((r) => r.status === 'rejected' && r.reason.name === 'RateLimitError')
      if (rateLimitResult) {
        console.error('🚫 触发速率限制 (429)!')
        console.log(`将等待 ${this.config.rateLimitWaitMs / 1000} 秒后重试...`)
        await this.delay(this.config.rateLimitWaitMs, this.config.rateLimitWaitMs)
        continue // 重新开始循环，重试同一个批次
      }

      // 直接在内存中的 progress 对象上更新，然后一次性写入存储
      for (const result of results) {
        const taskProgress: TaskProgress = {
          status: result.status,
          data: result.status === 'fulfilled' ? result.value : result.reason.message
        }
        progress[result.id] = taskProgress

        // 更新单个标签进度
        taskStore.updateProgress(result.id, taskProgress)
      }

      const currentCompleted = Object.keys(progress).length

      if (!this.executionState.isRunning) {
        console.log(`批次完成。进度: ${currentCompleted} / ${allTags.length}`)
        console.log('✅ 任务已应请求安全暂停。')
        return
      }

      const randomDelay =
        Math.floor(Math.random() * (this.config.maxDelayMs - this.config.minDelayMs + 1)) + this.config.minDelayMs
      console.log(
        `批次完成。进度: ${currentCompleted} / ${allTags.length}. 将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`
      )
      await this.delay(randomDelay, randomDelay)
    }

    this.executionState.isRunning = false
    this.executionState.currentTag = undefined
  }

  /**
   * 处理单个标签名的翻译和附加数据（与原始脚本的processTagName函数一致）
   */
  private async processTagName(tagName: string): Promise<PixivTagData> {
    const response = await this.fetchPixivTagData(tagName)

    // --- 数据提取 ---
    const body = response.body!
    const translationData = body.tagTranslation?.[tagName]
    const pixpedia = body.pixpedia || {}

    // 提取中文和英文翻译
    const chineseTranslation = translationData?.zh
    const englishTranslation = translationData?.en

    // 提取 abstract 和 image
    const abstract = pixpedia.abstract
    const imageUrl = pixpedia.image

    return {
      originalTag: tagName,
      translation: chineseTranslation || null,
      englishTranslation: englishTranslation || null,
      abstract: abstract || null,
      imageUrl: imageUrl || null
    }
  }

  private async delay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    return new Promise((resolve) => setTimeout(resolve, delay))
  }

  private async fetchPixivTagData(tag: string): Promise<PixivApiResponse> {
    const url = `https://www.pixiv.net/ajax/search/tags/${encodeURIComponent(tag)}?lang=zh`

    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: this.abortController?.signal
    })

    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429')
      error.name = 'RateLimitError'
      throw error
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status} for tag: ${tag}`)
    }

    const data = await response.json()

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`)
    }

    return data
  }

  private async downloadSingleImage(
    imageUrl: string
  ): Promise<{ success: boolean; arrayBuffer?: ArrayBuffer; mimeType?: string; error?: string }> {
    try {
      const blob = await this.downloadImageViaCanvas(imageUrl)
      const arrayBuffer = await blob.arrayBuffer()
      return { success: true, arrayBuffer, mimeType: blob.type }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载失败'
      }
    }
  }

  private async downloadImageViaCanvas(imageUrl: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          if (!ctx) {
            reject(new Error('无法获取canvas上下文'))
            return
          }

          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          ctx.drawImage(img, 0, 0)

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('无法将canvas转换为blob'))
              }
            },
            'image/jpeg',
            0.95
          )
        } catch (error) {
          reject(error)
        }
      }

      img.onerror = () => {
        reject(new Error('图片加载失败'))
      }

      img.src = imageUrl
    })
  }

  private async downloadFile(
    content: string | Blob,
    filename: string,
    mimeType: string,
    customDirectory?: string
  ): Promise<void> {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })

    // 如果指定了自定义目录，通过background script下载
    if (customDirectory) {
      try {
        await this.downloadWithBackgroundScript(blob, filename, customDirectory)
        return
      } catch (error) {
        console.warn('Background script 下载失败，回退到默认下载方式:', error)
      }
    }

    // 使用默认下载方式（直接下载到浏览器默认目录）
    this.downloadWithDefaultMethod(blob, filename)
  }

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
      // 假设 DownloadMessage 类型已更新
      type: 'DOWNLOAD_FILE',
      data: {
        dataUrl, // <-- 发送 dataUrl
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

  private downloadWithDefaultMethod(blob: Blob, filename: string): void {
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
}

// 创建单例实例
const contentPixivService = new ContentPixivService()

export default contentPixivService
export { ContentPixivService }
