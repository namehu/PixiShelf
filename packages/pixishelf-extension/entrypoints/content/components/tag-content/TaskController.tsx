import React from 'react'
import { useTagStore } from '../../stores/tagStore'
import { Button } from '@/components/ui/button'
import { useSettingStore } from '../../stores/setting-store'
import { MTagDownloadMode } from '@/enums/ETagDownloadMode'
import { useTagCrawler } from '../../hooks/useTagCrawler'
import { useLogger } from '../../hooks/useLogger'
import { db, TagItem } from '../../services/db'

export const TaskController: React.FC = () => {
  const { tagInput, setTagInput, isRunning, downloadProgress } = useTagStore()

  const { startTask, stopTask, downloadSqlFile, downloadTagImages } = useTagCrawler()
  const { success, warn, error: logError } = useLogger('tag')
  const tagDownloadMode = useSettingStore((state) => state.tagDownloadMode)
  const customDirectory = useSettingStore((state) => state.customDirectory)

  const handleStartTask = async () => {
    try {
      const pendingCount = await db.tags.where('status').equals('pending').count()
      if (pendingCount === 0) {
        return warn('没有待处理的标签')
      }
      await startTask()
    } catch (error) {
      logError(`任务执行失败: ${error}`)
    }
  }

  const handlePauseTask = async () => {
    stopTask()
  }

  const handleGenerateSQL = async () => {
    await downloadSqlFile()
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有标签数据吗？此操作不可恢复。')) return

    try {
      await db.tags.clear()
      warn('数据已清除')
    } catch (error) {
      logError(`清除失败: ${error}`)
    }
  }

  const handleDownloadImages = async () => {
    const hasImages = await db.tags.filter((tag) => !!(tag.data && tag.data.imageUrl)).count()
    if (hasImages === 0) {
      warn('没有找到可下载的图片')
      return
    }

    await downloadTagImages({
      downloadMode: tagDownloadMode,
      customDirectory: customDirectory.trim() || undefined
    })
  }

  const handleAddTags = async () => {
    if (!tagInput.trim()) return

    const tags = tagInput
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)

    if (tags.length === 0) {
      warn('请输入有效的标签')
      return
    }

    try {
      const uniqueInputTags = [...new Set(tags)]
      const existingItems = await db.tags.bulkGet(uniqueInputTags)

      const itemsToAdd: TagItem[] = uniqueInputTags
        .filter((_, index) => existingItems[index] === undefined)
        .map((name) => ({
          name,
          status: 'pending',
          updatedAt: Date.now()
        }))

      if (itemsToAdd.length > 0) {
        await db.tags.bulkAdd(itemsToAdd)
      }

      const added = itemsToAdd.length
      const duplicates = tags.length - added

      if (added === 0) {
        warn('没有添加任何新标签')
      } else {
        success(`成功添加 ${added} 个标签` + (duplicates > 0 ? `(忽略重复${duplicates}个)` : ''))
        setTagInput('')
      }
    } catch (err: any) {
      logError(`添加标签失败: ${err.message}`)
    }
  }

  return (
    <div className="task-controller">
      <div className="input-section" style={{}}>
        <textarea
          id="tag-input"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="添加标签(每行一个),例如:&#10;Genshin Impact&#10;原神&#10;..."
          rows={4}
          className="w-full p-2 border border-gray-300 rounded text-sm font-sans resize-y min-h-20"
        />
      </div>

      {/* 任务控制 */}
      <div className="control-section" style={{ marginBottom: '12px' }}>
        <Button
          variant={!tagInput.trim() ? 'secondary' : 'default'}
          onClick={handleAddTags}
          disabled={!tagInput.trim()}
          style={{ margin: '4px' }}
        >
          添加标签
        </Button>

        <Button
          variant={isRunning ? 'secondary' : 'default'}
          onClick={handleStartTask}
          disabled={isRunning}
          style={{ margin: '4px' }}
        >
          {isRunning ? '运行中...' : '开始抓取'}
        </Button>

        <Button
          variant={!isRunning ? 'secondary' : 'default'}
          onClick={handlePauseTask}
          disabled={!isRunning}
          style={{ margin: '4px' }}
        >
          暂停任务
        </Button>

        <Button variant="outline" onClick={handleGenerateSQL} disabled={isRunning} style={{ margin: '4px' }}>
          生成SQL
        </Button>
        <Button onClick={handleDownloadImages} variant="outline" disabled={downloadProgress.isDownloading}>
          {downloadProgress.isDownloading
            ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
            : `${MTagDownloadMode[tagDownloadMode]}封面图`}
        </Button>

        <Button variant="destructive" onClick={handleClear} disabled={isRunning} style={{ margin: '4px' }}>
          清除所有数据
        </Button>
      </div>
    </div>
  )
}
