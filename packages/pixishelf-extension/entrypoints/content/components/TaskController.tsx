import React from 'react'
import { useTaskStore } from '../stores/taskStore'
import ContentPixivService from '../services/ContentPixivService'
import { Button } from '@/components/ui/button'
import { useSettingStore } from '../stores/setting-store'
import { MTagDownloadMode } from '@/enums/ETagDownloadMode'

export const TaskController: React.FC = () => {
  const {
    tagInput,
    setTagInput,
    addTags,
    isRunning,
    downloadProgress,
    taskStats,
    setTaskStatus,
    setDownloadProgress,
    addLog,
    clearAll
  } = useTaskStore()

  const tagDownloadMode = useSettingStore((state) => state.tagDownloadMode)
  const customDirectory = useSettingStore((state) => state.customDirectory)

  const handleStartTask = async () => {
    try {
      addLog('开始抓取任务...')
      // 获取当前标签列表
      const tags = await ContentPixivService.getTags()
      if (!tags || tags.length === 0) {
        addLog('请先添加标签')
        return
      }

      setTaskStatus({ isRunning: true })
      ContentPixivService.processTags(tags)
    } catch (error) {
      addLog(`任务执行失败: ${error}`)
      setTaskStatus({ isRunning: false })
    }
  }

  const handlePauseTask = async () => {
    setTaskStatus({ isRunning: false })
    addLog('任务已暂停')
  }

  const handleGenerateSQL = async () => {
    try {
      const result = await ContentPixivService.downloadSqlFile()
      if (result.success) {
        addLog('SQL文件下载成功')
      } else {
        addLog(`SQL下载失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`SQL下载失败: ${error}`)
    }
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有数据吗？此操作不可恢复。')) return

    try {
      clearAll()
      addLog('进度已清除')
    } catch (error) {
      addLog(`清除进度失败: ${error}`)
    }
  }

  const handleDownloadImages = async () => {
    try {
      setDownloadProgress({ current: 0, total: 0, isDownloading: true })
      const modeText = MTagDownloadMode[tagDownloadMode]
      addLog(`开始${modeText}标签封面图...`)

      const result = await ContentPixivService.downloadTagImages({
        images: [], // 空数组，方法内部会自动收集图片
        downloadMode: tagDownloadMode,
        customDirectory: customDirectory.trim() || undefined,
        onProgress: (current, total) => {
          setDownloadProgress({ current, total, isDownloading: true })
          addLog(`图片下载进度: ${current}/${total}`)
        }
      })

      if (result.success) {
        addLog(`标签封面图${modeText}下载完成`)
      } else {
        addLog(`图片下载失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`图片下载失败: ${error}`)
    } finally {
      setDownloadProgress({ isDownloading: false })
    }
  }

  const handleAddTags = () => {
    if (!tagInput.trim()) return

    const result = addTags(tagInput)
    if (result.added === 0 && result.duplicates === 0) {
      addLog('请输入有效的标签')
      return
    }

    addLog(`成功添加 ${result.added} 个标签` + (result.duplicates ? `(忽略重复${result.duplicates}个)` : ''))
    setTagInput('')
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
        <Button
          onClick={handleDownloadImages}
          variant="outline"
          disabled={downloadProgress.isDownloading || taskStats.successful === 0}
        >
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
