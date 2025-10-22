import React, { useState } from 'react'
import { useTaskStore } from '../stores/taskStore'
import ContentPixivService from '../services/ContentPixivService'
import { DownloadMode } from '../../../types/service'
import { Button } from '@/components/ui/button'
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

const selectStyle = {
  padding: '8px 12px',
  margin: '4px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  fontSize: '14px',
  backgroundColor: 'white',
  cursor: 'pointer'
}

const labelStyle = {
  fontSize: '14px',
  fontWeight: '500',
  marginRight: '8px',
  color: '#333'
}

const inputStyle = {
  padding: '8px 12px',
  margin: '4px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  fontSize: '14px',
  backgroundColor: 'white',
  minWidth: '120px'
}

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

  // 下载模式状态
  const [downloadMode, setDownloadMode] = useState<DownloadMode>('individual')
  // 自定义下载目录状态
  const [customDirectory, setCustomDirectory] = useState<string>('tags')

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
      const modeText = downloadMode === 'zip' ? 'ZIP打包' : '单独文件'
      addLog(`开始${modeText}下载标签封面图...`)

      const result = await ContentPixivService.downloadTagImages({
        images: [], // 空数组，方法内部会自动收集图片
        downloadMode: downloadMode,
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

        <Button variant="destructive" onClick={handleClear} disabled={isRunning} style={{ margin: '4px' }}>
          清除所有数据
        </Button>
      </div>

      {/* 下载控制区域 */}
      <div className="mb-3 p-3 bg-gray-50 rounded-md border border-gray-200">
        <div className="mb-4 flex items-center flex-wrap">
          <span className="mr-2 text-sm font-medium text-gray-700">下载模式：</span>
          <select
            value={downloadMode}
            onChange={(e) => setDownloadMode(e.target.value as DownloadMode)}
            style={selectStyle}
            disabled={downloadProgress.isDownloading}
          >
            <option value="individual" className="text-sm font-sans">
              单独文件下载
            </option>
            <option value="zip" className="text-sm font-sans">
              ZIP打包下载
            </option>
          </select>
          <span className="text-xs text-gray-500 ml-2">
            {downloadMode === 'zip' ? '将所有图片打包为一个ZIP文件下载' : '每个图片单独下载，文件名包含标签前缀'}
          </span>
        </div>

        <div className="mb-4 flex items-center flex-wrap">
          <span className="mr-2 text-sm font-medium text-gray-700">下载目录：</span>
          <input
            type="text"
            value={customDirectory}
            onChange={(e) => setCustomDirectory(e.target.value)}
            placeholder="例如: tags"
            style={inputStyle}
            disabled={downloadProgress.isDownloading}
          />
          <span style={{ fontSize: '12px', color: '#666', marginLeft: '12px' }}>
            {customDirectory.trim()
              ? `文件将下载到: Downloads/${customDirectory.trim()}/`
              : '留空则下载到默认Downloads文件夹'}
          </span>
        </div>

        <button
          onClick={handleDownloadImages}
          disabled={downloadProgress.isDownloading || taskStats.successful === 0}
          style={
            downloadProgress.isDownloading || taskStats.successful === 0 ? disabledButtonStyle : secondaryButtonStyle
          }
        >
          {downloadProgress.isDownloading
            ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
            : `${downloadMode === 'zip' ? 'ZIP打包' : '单独'}下载封面图`}
        </button>
      </div>
    </div>
  )
}
