import localforage from 'localforage';
import JSZip from 'jszip';
import { 
  PixivTagData, 
  TaskProgress, 
  ProgressStorage, 
  TaskConfig, 
  TaskStats,
  PixivApiResponse 
} from '../types/pixiv';

// 配置常量
const CONFIG: TaskConfig = {
  CONCURRENT_REQUESTS: 3,
  MIN_DELAY_MS: 1000,
  MAX_DELAY_MS: 4000,
  RATE_LIMIT_WAIT_MS: 60000,
  STORAGE_KEY: 'pixiv_tag_translator_progress_v1',
  IDS_STORAGE_KEY: 'pixiv_tag_translator_ids_v1',
  SQL_FILENAME: 'update_pixiv_tag_translations.sql',
  TAG_IMAGES_ZIP_FILENAME: 'pixiv_tag_images.zip'
};

class PixivTagService {
  private isPaused = false;
  private isRunning = false;

  constructor() {
    // 配置 localforage
    localforage.config({
      name: 'PixivExtension',
      storeName: 'pixiv_tags'
    });
  }

  /**
   * 处理单个标签名的翻译和附加数据
   */
  async processTagName(tagName: string): Promise<PixivTagData> {
    const apiUrl = `https://www.pixiv.net/ajax/search/tags/${encodeURIComponent(tagName)}?lang=zh`;
    
    const response = await fetch(apiUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (response.status === 429) {
      const error = new Error('HTTP 请求失败! 状态: 429');
      error.name = 'RateLimitError';
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP 请求失败! 状态: ${response.status} for tag: ${tagName}`);
    }

    const data: PixivApiResponse = await response.json();

    if (data.error || !data.body) {
      throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`);
    }

    // 数据提取
    const body = data.body;
    const translationData = body.tagTranslation?.[tagName];
    const pixpedia = body.pixpedia || {};

    // 提取中文和英文翻译
    const chineseTranslation = translationData?.zh;
    const englishTranslation = translationData?.en;

    // 提取 abstract 和 image
    const abstract = pixpedia.abstract;
    const imageUrl = pixpedia.image;

    return {
      originalTag: tagName,
      translation: chineseTranslation || null,
      englishTranslation: englishTranslation || null,
      abstract: abstract || null,
      imageUrl: imageUrl || null
    };
  }

  /**
   * 启动或恢复抓取任务
   */
  async runTask(onProgress?: (stats: TaskStats) => void): Promise<void> {
    if (this.isRunning) {
      console.log('任务已在运行中');
      return;
    }

    this.isPaused = false;
    this.isRunning = true;
    console.log('🚀 开始或恢复 Pixiv 标签翻译抓取任务...');

    try {
      // 从存储读取标签列表和进度
      const storedTags = (await localforage.getItem<string[]>(CONFIG.IDS_STORAGE_KEY)) || [];
      const allTags = [...new Set(storedTags)];
      let progress = (await localforage.getItem<ProgressStorage>(CONFIG.STORAGE_KEY)) || {};

      while (this.isRunning && !this.isPaused) {
        const completedTags = new Set(Object.keys(progress));
        const pendingTags = allTags.filter(tag => !completedTags.has(tag));

        if (pendingTags.length === 0) {
          console.log('✨ 所有标签均已处理完毕!');
          break;
        }

        // 更新进度回调
        if (onProgress) {
          const stats = this.calculateStats(allTags, progress);
          onProgress(stats);
        }

        console.log(`总计: ${allTags.length}, 已完成: ${completedTags.size}, 待处理: ${pendingTags.length}`);

        const batch = pendingTags.slice(0, CONFIG.CONCURRENT_REQUESTS);
        console.log(`--- 正在处理批次 (数量: ${batch.length}) ---`);

        const promises = batch.map(tag =>
          this.processTagName(tag)
            .then(data => ({ id: tag, status: 'fulfilled' as const, value: data }))
            .catch(error => ({ id: tag, status: 'rejected' as const, reason: error }))
        );

        const results = await Promise.all(promises);

        // 检查速率限制
        const rateLimitResult = results.find(r => 
          r.status === 'rejected' && 
          (r.reason as Error).name === 'RateLimitError'
        );
        
        if (rateLimitResult) {
          console.error('🚫 触发速率限制 (429)!');
          console.log(`将等待 ${CONFIG.RATE_LIMIT_WAIT_MS / 1000} 秒后重试...`);
          await this.delay(CONFIG.RATE_LIMIT_WAIT_MS);
          continue;
        }

        // 更新进度
        for (const result of results) {
          progress[result.id] = {
            status: result.status,
            data: result.status === 'fulfilled' ? result.value : (result.reason as Error).message
          };
        }
        await localforage.setItem(CONFIG.STORAGE_KEY, progress);

        if (this.isPaused) {
          console.log('✅ 任务已应请求安全暂停。');
          break;
        }

        // 随机延迟
        const randomDelay = Math.floor(
          Math.random() * (CONFIG.MAX_DELAY_MS - CONFIG.MIN_DELAY_MS + 1)
        ) + CONFIG.MIN_DELAY_MS;
        
        console.log(`批次完成。将等待 ${(randomDelay / 1000).toFixed(1)} 秒...`);
        await this.delay(randomDelay);
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 暂停任务
   */
  pauseTask(): void {
    console.log('⏸️ 请求暂停...');
    this.isPaused = true;
  }

  /**
   * 添加新的标签名到任务列表
   */
  async addTagNames(newTags: string[]): Promise<void> {
    if (!Array.isArray(newTags) || newTags.length === 0) {
      throw new Error('请输入一个有效的标签名数组');
    }

    const storedTags = (await localforage.getItem<string[]>(CONFIG.IDS_STORAGE_KEY)) || [];
    const combinedTags = new Set([...storedTags, ...newTags]);
    await localforage.setItem(CONFIG.IDS_STORAGE_KEY, [...combinedTags]);

    console.log(`✅ 已成功添加 ${newTags.length} 个新标签。`);
  }

  /**
   * 获取当前进度统计
   */
  async getProgress(): Promise<TaskStats> {
    const progress = (await localforage.getItem<ProgressStorage>(CONFIG.STORAGE_KEY)) || {};
    const allTags = (await localforage.getItem<string[]>(CONFIG.IDS_STORAGE_KEY)) || [];
    
    return this.calculateStats(allTags, progress);
  }

  /**
   * 清除所有进度和标签列表
   */
  async clearProgress(): Promise<void> {
    await localforage.removeItem(CONFIG.STORAGE_KEY);
    await localforage.removeItem(CONFIG.IDS_STORAGE_KEY);
    console.log('🧹 进度和标签列表已清除。');
  }

  /**
   * 生成SQL更新文件
   */
  async generateUpdateSQL(): Promise<void> {
    const progress = (await localforage.getItem<ProgressStorage>(CONFIG.STORAGE_KEY)) || {};
    const successfulItems = Object.values(progress).filter(
      p => p.status === 'fulfilled' && p.data
    );

    if (successfulItems.length === 0) {
      throw new Error('没有可供生成 SQL 的成功数据');
    }

    // 使用 Map 确保每个标签只生成一条唯一的更新语句
    const uniqueTagData = new Map<string, PixivTagData>();
    for (const { data } of successfulItems) {
      const tagData = data as PixivTagData;
      if (tagData.originalTag) {
        uniqueTagData.set(tagData.originalTag, tagData);
      }
    }

    if (uniqueTagData.size === 0) {
      throw new Error('没有找到有效的标签数据来生成SQL');
    }

    const escapeSql = (str: string) => str.replace(/'/g, "''");
    let sqlStatements = [
      '-- Pixiv 标签数据更新脚本',
      '-- 生成时间: ' + new Date().toISOString(),
      ''
    ];
    let updateCount = 0;

    for (const [originalTag, data] of uniqueTagData.entries()) {
      const setClauses = [];
      const name = escapeSql(data.originalTag);
      
      // 动态构建 SET 子句
      if (!!data.translation || !!data.englishTranslation) {
        setClauses.push(`"translateType" = 'PIXIV'`);
      }
      if (data.translation) {
        setClauses.push(`"name_zh" = '${escapeSql(data.translation)}'`);
      }
      if (data.englishTranslation) {
        setClauses.push(`"name_en" = '${escapeSql(data.englishTranslation)}'`);
      }
      if (data.abstract) {
        setClauses.push(`"abstract" = '${escapeSql(data.abstract)}'`);
      }
      if (data.imageUrl) {
        const imageUrl = data.imageUrl.split('/').pop();
        setClauses.push(`"image" = '/${escapeSql(imageUrl!)}'`);
      }

      if (setClauses.length > 0) {
        const sql = `UPDATE "Tag" SET ${setClauses.join(', ')} WHERE "name" = '${name}';`;
        sqlStatements.push(sql);
        updateCount++;
      }
    }

    if (updateCount === 0) {
      throw new Error('没有需要更新的字段，不生成 SQL 文件');
    }

    const sqlContent = sqlStatements.join('\n');
    this.downloadFile(sqlContent, CONFIG.SQL_FILENAME, 'application/sql;charset=utf-8');
    
    console.log(`📜 ${CONFIG.SQL_FILENAME} 文件已生成并开始下载! 包含 ${updateCount} 条更新语句。`);
  }

  /**
   * 批量下载所有标签的封面图
   */
  async downloadTagImages(onProgress?: (current: number, total: number) => void): Promise<void> {
    const progress = (await localforage.getItem<ProgressStorage>(CONFIG.STORAGE_KEY)) || {};
    const successfulItems = Object.values(progress).filter(
      p => p.status === 'fulfilled' && p.data && (p.data as PixivTagData).imageUrl
    );

    if (successfulItems.length === 0) {
      throw new Error('没有找到带有封面图的标签可供下载');
    }

    console.log(`发现 ${successfulItems.length} 个带封面图的标签。开始下载...`);
    const zip = new JSZip();
    const rootFolder = zip.folder("tags");
    let successCount = 0;

    for (const [index, { data }] of successfulItems.entries()) {
      try {
        const tagData = data as PixivTagData;
        const response = await fetch(tagData.imageUrl!);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();

        // 从URL中提取文件名
        const fileName = tagData.imageUrl!.split('/').pop()!.split('?')[0];
        rootFolder!.file(fileName, blob);

        successCount++;
        console.log(`✅ (${successCount}/${successfulItems.length}) 成功下载标签 "${tagData.originalTag}" 的封面图。`);

        // 更新进度回调
        if (onProgress) {
          onProgress(successCount, successfulItems.length);
        }

      } catch (error) {
        const tagData = data as PixivTagData;
        console.error(`❌ 下载标签 "${tagData.originalTag}" 的封面图失败:`, (error as Error).message);
      }
      // 每次下载后随机延迟，避免对图片服务器造成太大压力
      await this.delay(Math.random() * 500 + 200);
    }

    if (successCount === 0) {
      throw new Error('所有封面图均下载失败，不生成 zip 文件');
    }

    console.log(`正在生成 ${CONFIG.TAG_IMAGES_ZIP_FILENAME} 文件，请稍候...`);
    const content = await zip.generateAsync({ type: "blob" });
    this.downloadFile(content, CONFIG.TAG_IMAGES_ZIP_FILENAME, 'application/zip');
    
    console.log(`📦 ${CONFIG.TAG_IMAGES_ZIP_FILENAME} 下载已开始!`);
  }

  /**
   * 获取任务运行状态
   */
  getTaskStatus(): { isRunning: boolean; isPaused: boolean } {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused
    };
  }

  // 私有辅助方法
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateStats(allTags: string[], progress: ProgressStorage): TaskStats {
    const totalTags = new Set(allTags).size;
    const completedCount = Object.keys(progress).length;
    const successCount = Object.values(progress).filter(p => p.status === 'fulfilled').length;
    const errorCount = completedCount - successCount;

    return {
      total: totalTags,
      completed: completedCount,
      successful: successCount,
      failed: errorCount,
      pending: totalTags - completedCount
    };
  }

  private downloadFile(content: string | Blob, filename: string, mimeType?: string): void {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export default new PixivTagService();