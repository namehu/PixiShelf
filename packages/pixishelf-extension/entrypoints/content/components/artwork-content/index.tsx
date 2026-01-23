import { BaseLogViewer } from '../BaseLogViewer'
import { useArtworkTaskStore } from '../../stores/artworkTaskStore'
import { BaseProgressDisplay } from '../BaseProgressDisplay'
import { useLogger } from '../../hooks/useLogger'
import { useArtworkCrawler } from '../../hooks/useArtworkCrawler'
import { useShallow } from 'zustand/shallow'
import { downloadFile, generateArtworkSql } from '../../utils/sql-helper'
import { Button } from '@/components/ui/button'

export default function ArtworkContent() {
  const { logs, clear, log, error: logError, success, warn } = useLogger('artwork')

  const { taskStats, artworkInput, setArtworkInput, addIds, isRunning, clearAll, artworkList, successfulArtworks } =
    useArtworkTaskStore(
      useShallow((state) => ({
        taskStats: state.taskStats,
        artworkInput: state.artworkInput,
        setArtworkInput: state.setArtworkInput,
        addIds: state.addIds,
        isRunning: state.isRunning,
        clearAll: state.clearAll,
        artworkList: state.artworkList,
        successfulArtworks: state.successfulArtworks
      }))
    )

  const { startTask, stopTask } = useArtworkCrawler()

  const handleStartTask = async () => {
    try {
      log('开始抓取作品信息任务...')
      if (!artworkList || artworkList.length === 0) {
        warn('请先添加作品ID')
        return
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
    try {
      const result = generateArtworkSql(successfulArtworks.map((item) => item.data))
      if (result.success && result.content) {
        const downloadResult = downloadFile(result.content, `pixiv_artworks_${new Date().getTime()}.sql`)
        if (downloadResult.success) {
          success('SQL文件下载成功')
        } else {
          logError(`SQL下载失败: ${downloadResult.error}`)
        }
      } else {
        logError(`SQL生成失败: ${result.error}`)
      }
    } catch (error) {
      logError(`SQL下载失败: ${error}`)
    }
  }

  const handleClear = async () => {
    if (!confirm('确定要清除所有作品数据吗？此操作不可恢复。')) return

    try {
      clearAll()
      warn('数据已清除')
    } catch (error) {
      logError(`清除失败: ${error}`)
    }
  }

  const handleAddArtworks = () => {
    if (!artworkInput.trim()) return

    const ids = artworkInput
      .split(/[\n,]+/) // Split by newline or comma
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && /^\d+$/.test(id)) // Ensure numeric ID

    if (ids.length === 0) {
      warn('请输入有效的作品ID')
      return
    }

    const result = addIds(ids)

    if (result.added === 0 && result.duplicates === 0) {
      warn('没有添加任何新作品ID')
      return
    }

    success(`成功添加 ${result.added} 个作品` + (result.duplicates ? `(忽略重复${result.duplicates}个)` : ''))
    setArtworkInput('')
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-bold text-2xl">作品信息管理</h3>

      <div className="task-controller bg-white rounded-lg shadow space-y-4">
        <textarea
          value={artworkInput}
          onChange={(e) => setArtworkInput(e.target.value)}
          placeholder="添加作品ID(每行一个), 例如:&#10;139095372&#10;..."
          rows={4}
          className="w-full p-2 border border-gray-300 rounded text-sm font-sans resize-y min-h-20"
        />

        {/* 任务控制 */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={!artworkInput.trim() ? 'secondary' : 'default'}
            onClick={handleAddArtworks}
            disabled={!artworkInput.trim()}
          >
            添加ID
          </Button>

          <Button variant={isRunning ? 'secondary' : 'default'} onClick={handleStartTask} disabled={isRunning}>
            {isRunning ? '运行中...' : '开始抓取'}
          </Button>

          <Button variant={!isRunning ? 'secondary' : 'default'} onClick={handlePauseTask} disabled={!isRunning}>
            暂停任务
          </Button>

          <Button variant="outline" onClick={handleGenerateSQL} disabled={isRunning}>
            生成SQL
          </Button>

          <Button variant="destructive" onClick={handleClear} disabled={isRunning}>
            清除所有数据
          </Button>
        </div>
      </div>

      <BaseProgressDisplay stats={taskStats} />

      <BaseLogViewer logs={logs} onClear={clear} />
    </div>
  )
}
