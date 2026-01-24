import { BaseLogViewer } from '../BaseLogViewer'
import { useArtworkTaskStore } from '../../stores/artworkTaskStore'
import { BaseProgressDisplay } from '../BaseProgressDisplay'
import { useLogger } from '../../hooks/useLogger'
import { useArtworkCrawler } from '../../hooks/useArtworkCrawler'
import { useShallow } from 'zustand/shallow'
import { downloadFile, generateArtworkSql } from '../../utils/sql-helper'
import { Button } from '@/components/ui/button'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ArtworkItem } from '../../services/db'

export default function ArtworkContent() {
  const { logs, clear, error: logError, success, warn } = useLogger('artwork')

  const { artworkInput, setArtworkInput, isRunning } = useArtworkTaskStore(
    useShallow((state) => ({
      artworkInput: state.artworkInput,
      setArtworkInput: state.setArtworkInput,
      isRunning: state.isRunning
    }))
  )

  const taskStats = useLiveQuery(async () => {
    return {
      total: await db.tasks.count(),
      completed:
        (await db.tasks.where('status').equals('fulfilled').count()) +
        (await db.tasks.where('status').equals('rejected').count()),
      successful: await db.tasks.where('status').equals('fulfilled').count(),
      failed: await db.tasks.where('status').equals('rejected').count(),
      pending:
        (await db.tasks.where('status').equals('pending').count()) +
        (await db.tasks.where('status').equals('running').count())
    }
  }, []) || { total: 0, completed: 0, successful: 0, failed: 0, pending: 0 }

  const { startTask, stopTask } = useArtworkCrawler()

  const handleStartTask = async () => {
    try {
      const pendingCount = await db.tasks.where('status').equals('pending').count()
      if (pendingCount === 0) {
        return warn('没有待处理的任务')
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
      const successfulItems = await db.tasks.where('status').equals('fulfilled').toArray()
      const validData = successfulItems.filter((item) => item.data).map((item) => item.data!)

      // @ts-ignore
      const result = generateArtworkSql(validData)
      if (result.success && result.content) {
        const timestamp = new Date().getTime()

        // Handle new return structure { series: string, noSeries: string, tags: string }
        // We cast to any/unknown because the type inference might need a moment or explicit interface
        const content = result.content as unknown as { series: string; noSeries: string; tags: string }

        const seriesRes = downloadFile(content.series, `pixiv_artworks_series_${timestamp}.sql`)
        const noSeriesRes = downloadFile(content.noSeries, `pixiv_artworks_noseries_${timestamp}.sql`)
        const tagsRes = downloadFile(content.tags, `pixiv_artworks_tags_${timestamp}.sql`)

        if (seriesRes.success && noSeriesRes.success && tagsRes.success) {
          success('SQL文件下载成功 (Series, No-Series & Tags)')
        } else {
          const errors = []
          if (!seriesRes.success) errors.push(`Series: ${seriesRes.error}`)
          if (!noSeriesRes.success) errors.push(`NoSeries: ${noSeriesRes.error}`)
          if (!tagsRes.success) errors.push(`Tags: ${tagsRes.error}`)
          logError(`SQL下载部分失败: ${errors.join(', ')}`)
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
      await db.tasks.clear()
      warn('数据已清除')
    } catch (error) {
      logError(`清除失败: ${error}`)
    }
  }

  const handleAddArtworks = async () => {
    if (!artworkInput.trim()) return

    const ids = artworkInput
      .split(/[\n,]+/) // Split by newline or comma
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && /^\d+$/.test(id)) // Ensure numeric ID

    if (ids.length === 0) {
      warn('请输入有效的作品ID')
      return
    }

    try {
      const uniqueInputIds = [...new Set(ids)]
      const existingItems = await db.tasks.bulkGet(uniqueInputIds)

      // newIds are those where existingItems[i] is undefined
      const newIds = uniqueInputIds.filter((_, index) => existingItems[index] === undefined)

      const itemsToAdd: ArtworkItem[] = newIds.map((id) => ({
        id,
        status: 'pending',
        updatedAt: Date.now()
      }))

      if (itemsToAdd.length > 0) {
        await db.tasks.bulkAdd(itemsToAdd)
      }

      const added = itemsToAdd.length
      const duplicates = uniqueInputIds.length - added

      if (added === 0) {
        warn('没有添加任何新作品ID')
        return
      }

      success(`成功添加 ${added} 个作品` + (duplicates > 0 ? `(忽略重复${duplicates}个)` : ''))
      setArtworkInput('')
    } catch (err: any) {
      logError(`添加失败: ${err.message}`)
    }
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
