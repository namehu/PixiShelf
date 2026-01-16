import React from 'react'
import { useArtworkTaskStore } from '../stores/artworkTaskStore'
import ArtworkPixivService from '../services/ArtworkPixivService'
import { Button } from '@/components/ui/button'

export const ArtworkTaskController: React.FC = () => {
  const {
    artworkInput,
    setArtworkInput,
    addArtworks,
    isRunning,
    taskStats,
    setTaskStatus,
    addLog,
    clearAll,
    getArtworkList
  } = useArtworkTaskStore()

  const handleStartTask = async () => {
    try {
      addLog('开始抓取作品信息任务...')
      const ids = getArtworkList()
      if (!ids || ids.length === 0) {
        addLog('请先添加作品ID')
        return
      }

      setTaskStatus({ isRunning: true })
      ArtworkPixivService.processArtworks(ids)
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
      const result = await ArtworkPixivService.downloadSqlFile()
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
    if (!confirm('确定要清除所有作品数据吗？此操作不可恢复。')) return

    try {
      clearAll()
      addLog('数据已清除')
    } catch (error) {
      addLog(`清除失败: ${error}`)
    }
  }

  const handleAddArtworks = () => {
    if (!artworkInput.trim()) return

    const result = addArtworks(artworkInput)
    if (result.added === 0 && result.duplicates === 0) {
      addLog('请输入有效的作品ID')
      return
    }

    addLog(`成功添加 ${result.added} 个作品` + (result.duplicates ? `(忽略重复${result.duplicates}个)` : ''))
    setArtworkInput('')
  }

  return (
    <div className="task-controller p-4 bg-white rounded-lg shadow space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">作品信息下载</h3>
        <textarea
          value={artworkInput}
          onChange={(e) => setArtworkInput(e.target.value)}
          placeholder="添加作品ID(每行一个), 例如:&#10;139095372&#10;..."
          rows={4}
          className="w-full p-2 border border-gray-300 rounded text-sm font-sans resize-y min-h-20"
        />
      </div>

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

      {/* 统计信息 */}
      <div className="text-sm text-gray-500 space-y-1">
        <div className="flex justify-between">
          <span>总任务数: {taskStats.total}</span>
          <span>已完成: {taskStats.completed}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-600">成功: {taskStats.successful}</span>
          <span className="text-red-600">失败: {taskStats.failed}</span>
        </div>
        <div>剩余: {taskStats.pending}</div>
      </div>
    </div>
  )
}
