import localforage from 'localforage'
import { ProgressStorage, TaskStats } from '../../types/pixiv'

/**
 * 存储管理器
 * 使用 localforage 替代 chrome.storage.local，提供更大存储容量和更好的通用性
 */
class StorageManager {
  private readonly STORAGE_KEY = 'pixiv_tag_translator_progress_v1'
  private readonly IDS_STORAGE_KEY = 'pixiv_tag_translator_ids_v1'

  // 配置 localforage 实例
  private storage: LocalForage

  constructor() {
    this.storage = localforage.createInstance({
      name: 'pixiv-extension',
      storeName: 'storage-manager'
    })
  }

  /**
   * 获取标签列表
   */
  async getTagList(): Promise<string[]> {
    try {
      const tags = await this.storage.getItem<string[]>(this.IDS_STORAGE_KEY)
      return tags || []
    } catch (error) {
      console.error('Failed to get tag list:', error)
      return []
    }
  }

  /**
   * 保存标签列表
   */
  async setTagList(tags: string[]): Promise<void> {
    try {
      await this.storage.setItem(this.IDS_STORAGE_KEY, tags)
    } catch (error) {
      console.error('Failed to save tag list:', error)
      throw error
    }
  }

  /**
   * 添加新标签到列表
   */
  async addTags(newTags: string[]): Promise<void> {
    try {
      // 输入验证，与原始脚本保持一致
      if (!Array.isArray(newTags) || newTags.length === 0) {
        console.log('请输入一个有效的标签名数组。')
        return
      }

      const existingTags = await this.getTagList()
      const combinedTags = new Set([...existingTags, ...newTags])
      await this.setTagList([...combinedTags])

      console.log(`✅ 已成功添加 ${newTags.length} 个新标签。`)
    } catch (error) {
      console.error('Failed to add tags:', error)
      throw error
    }
  }

  /**
   * 获取进度数据
   */
  async getProgress(): Promise<ProgressStorage> {
    try {
      const progress = await this.storage.getItem<ProgressStorage>(this.STORAGE_KEY)
      return progress || {}
    } catch (error) {
      console.error('Failed to get progress:', error)
      return {}
    }
  }

  /**
   * 保存进度数据
   */
  async setProgress(progress: ProgressStorage): Promise<void> {
    try {
      await this.storage.setItem(this.STORAGE_KEY, progress)
    } catch (error) {
      console.error('Failed to save progress:', error)
      throw error
    }
  }

  /**
   * 更新单个标签的进度
   */
  async updateTagProgress(tagName: string, progress: ProgressStorage[string]): Promise<void> {
    try {
      const currentProgress = await this.getProgress()
      currentProgress[tagName] = progress
      await this.setProgress(currentProgress)
    } catch (error) {
      console.error('Failed to update tag progress:', error)
      throw error
    }
  }

  /**
   * 移除单个标签的进度
   */
  async removeTaskProgress(tag: string): Promise<void> {
    try {
      const currentProgress = await this.getProgress()
      delete currentProgress[tag]
      await this.setProgress(currentProgress)
    } catch (error) {
      console.error('Failed to remove tag progress:', error)
      throw error
    }
  }

  /**
   * 清除所有进度数据
   */
  async clearTaskProgress(): Promise<void> {
    try {
      await this.storage.removeItem(this.STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear task progress:', error)
      throw error
    }
  }

  /**
   * 清除所有数据
   */
  async clearAll(): Promise<void> {
    try {
      await this.storage.removeItem(this.STORAGE_KEY)
      await this.storage.removeItem(this.IDS_STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear storage:', error)
      throw error
    }
  }

  /**
   * 计算任务统计信息
   */
  async getTaskStats(): Promise<TaskStats> {
    try {
      const [allTags, progress] = await Promise.all([this.getTagList(), this.getProgress()])

      const totalTags = new Set(allTags).size
      const completedCount = Object.keys(progress).length
      const successCount = Object.values(progress).filter((p) => p.status === 'fulfilled').length
      const errorCount = completedCount - successCount

      return {
        total: totalTags,
        completed: completedCount,
        successful: successCount,
        failed: errorCount,
        pending: totalTags - completedCount
      }
    } catch (error) {
      console.error('Failed to calculate task stats:', error)
      return {
        total: 0,
        completed: 0,
        successful: 0,
        failed: 0,
        pending: 0
      }
    }
  }

  /**
   * 获取成功的标签数据
   */
  async getSuccessfulTags(): Promise<Array<{ tagName: string; data: any }>> {
    try {
      const progress = await this.getProgress()
      return Object.entries(progress)
        .filter(([_, p]) => p.status === 'fulfilled' && p.data)
        .map(([tagName, p]) => ({ tagName, data: p.data }))
    } catch (error) {
      console.error('Failed to get successful tags:', error)
      return []
    }
  }

  /**
   * 获取带有图片的标签数据
   */
  async getTagsWithImages(): Promise<Array<{ tagName: string; data: any }>> {
    try {
      const successfulTags = await this.getSuccessfulTags()
      return successfulTags.filter(({ data }) => data && data.imageUrl)
    } catch (error) {
      console.error('Failed to get tags with images:', error)
      return []
    }
  }

  /**
   * 筛选失败的数据，并可选择性删除
   * 与原始脚本的 filterFailedData 方法保持一致
   * @param stringReg - 用于匹配错误消息的正则表达式字符串。如果为空或null，则匹配所有失败项
   * @param isDel - 如果为 true，则从进度中删除匹配的失败项
   * @returns 一个解析为匹配到的任务 ID 数组的 Promise
   */
  async filterFailedData(stringReg?: string, isDel: boolean = false): Promise<string[]> {
    try {
      console.log(`正在筛选失败的数据... Regex: /${stringReg}/, 删除: ${isDel}`)

      const progress = await this.getProgress()
      const failedIds: string[] = []
      let regex: RegExp | undefined

      try {
        if (stringReg) {
          regex = new RegExp(stringReg)
        }
      } catch (e) {
        console.error('❌ 无效的正则表达式:', e instanceof Error ? e.message : '未知错误')
        return []
      }

      for (const [id, result] of Object.entries(progress)) {
        if (result.status === 'rejected') {
          // 确保 result.data 是字符串类型以避免 .test() 方法出错
          const errorMessage = typeof result.data === 'string' ? result.data : ''
          if (!stringReg || (regex && regex.test(errorMessage))) {
            failedIds.push(id)
          }
        }
      }

      if (failedIds.length === 0) {
        console.log('没有找到匹配条件的失败数据。')
        return []
      }

      if (isDel) {
        console.log(`找到 ${failedIds.length} 个匹配项，准备删除...`)
        for (const id of failedIds) {
          delete progress[id]
        }
        await this.setProgress(progress)
        console.log(`✅ 已成功删除 ${failedIds.length} 条失败记录。`)
      } else {
        console.log(`✅ 找到 ${failedIds.length} 个匹配的失败ID:`, failedIds)
      }

      return failedIds
    } catch (error) {
      console.error('Failed to filter failed data:', error)
      return []
    }
  }

  /**
   * 获取失败的标签数据
   */
  async getFailedTags(): Promise<Array<{ tagName: string; error: string }>> {
    try {
      const progress = await this.getProgress()
      return Object.entries(progress)
        .filter(([_, p]) => p.status === 'rejected')
        .map(([tagName, p]) => ({
          tagName,
          error: typeof p.data === 'string' ? p.data : '未知错误'
        }))
    } catch (error) {
      console.error('Failed to get failed tags:', error)
      return []
    }
  }

  /**
   * 显示当前进度的摘要
   * 与原始脚本的 checkProgress 方法保持一致
   */
  async checkProgress(): Promise<void> {
    try {
      const progress = await this.getProgress()
      const allTags = await this.getTagList()
      const totalTags = new Set(allTags).size
      const completedCount = Object.keys(progress).length
      const successCount = Object.values(progress).filter((p) => p.status === 'fulfilled').length
      const errorCount = completedCount - successCount

      console.log('--- 标签翻译抓取器进度 ---')
      console.log(`- 已处理 ${completedCount} / ${totalTags} 个标签。`)
      console.log(`- ✅ 成功: ${successCount}`)
      console.log(`- ❌ 失败: ${errorCount}`)
      console.log('--------------------------')
    } catch (error) {
      console.error('Failed to check progress:', error)
    }
  }
}

export default new StorageManager()
