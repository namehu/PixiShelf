import React from 'react'
import { useTaskStore } from '../stores/taskStore'
import ContentPixivService from '../services/ContentPixivService'

export const TaskController: React.FC = () => {
  const {
    isRunning,
    downloadProgress,
    taskStats,
    setTaskStatus,
    setTaskStats,
    setDownloadProgress,
    addLog,
    resetTaskState
  } = useTaskStore()

  const handleStartTask = async () => {
    try {
      addLog('开始抓取任务...')
      setTaskStatus({ isRunning: true })

      // 获取当前标签列表
      const tags = await ContentPixivService.getTags()
      if (!tags || tags.length === 0) {
        addLog('请先添加标签')
        return
      }

      const result = await ContentPixivService.startTask(tags)
      if (!result.success) {
        throw new Error(result.error || '启动任务失败')
      }

      addLog('任务启动成功')
      // 重新加载进度
      const progressResult = await ContentPixivService.getProgress()
      setTaskStats(progressResult)
    } catch (error) {
      addLog(`任务执行失败: ${error}`)
    } finally {
      setTaskStatus({ isRunning: false })
    }
  }

  const handlePauseTask = async () => {
    try {
      const result = await ContentPixivService.pauseTask()
      if (result.success) {
        addLog('任务已暂停')
        setTaskStatus({ isPaused: true })
      } else {
        addLog(`暂停任务失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`暂停任务失败: ${error}`)
    }
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

  const handleClearProgress = async () => {
    if (!confirm('确定要清除所有进度吗？此操作不可恢复。')) return

    try {
      const result = await ContentPixivService.clearProgress()
      if (result.success) {
        resetTaskState()
        addLog('进度已清除')
      } else {
        addLog(`清除进度失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`清除进度失败: ${error}`)
    }
  }

  const handleDownloadImages = async () => {
    try {
      setDownloadProgress({ current: 0, total: 0, isDownloading: true })
      addLog('开始下载标签封面图...')

      const result = await ContentPixivService.downloadTagImages({
        images: [], // 空数组，方法内部会自动收集图片
        onProgress: (current, total) => {
          setDownloadProgress({ current, total, isDownloading: true })
          addLog(`图片下载进度: ${current}/${total}`)
        }
      })

      if (result.success) {
        addLog('标签封面图下载完成')
      } else {
        addLog(`图片下载失败: ${result.error}`)
      }
    } catch (error) {
      addLog(`图片下载失败: ${error}`)
    } finally {
      setDownloadProgress({ isDownloading: false })
    }
  }

  const buttonStyle = {
    padding: '8px 12px',
    margin: '4px',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  }

  const primaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#0066cc',
    color: 'white'
  }

  const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#f0f0f0',
    color: '#333'
  }

  const dangerButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#dc3545',
    color: 'white'
  }

  const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#ccc',
    color: '#666',
    cursor: 'not-allowed'
  }

  return (
    <div className="task-controller">
      {/* 任务控制 */}
      <div className="control-section" style={{ marginBottom: '16px' }}>
        <button
          onClick={handleStartTask}
          disabled={isRunning}
          style={isRunning ? disabledButtonStyle : primaryButtonStyle}
        >
          {isRunning ? '运行中...' : '开始抓取'}
        </button>

        <button
          onClick={handlePauseTask}
          disabled={!isRunning}
          style={!isRunning ? disabledButtonStyle : secondaryButtonStyle}
        >
          暂停任务
        </button>

        <button onClick={handleGenerateSQL} style={secondaryButtonStyle}>
          生成SQL文件
        </button>

        <button
          onClick={handleDownloadImages}
          disabled={downloadProgress.isDownloading || taskStats.successful === 0}
          style={
            downloadProgress.isDownloading || taskStats.successful === 0 ? disabledButtonStyle : secondaryButtonStyle
          }
        >
          {downloadProgress.isDownloading
            ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
            : '下载封面图'}
        </button>

        <button onClick={handleClearProgress} style={dangerButtonStyle}>
          清除进度
        </button>
      </div>
    </div>
  )
}
