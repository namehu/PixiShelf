import { useState, useEffect } from 'react'
import './App.css'
import pixivTagService from '../services/pixivTagService'
import { TaskStats } from '../types/pixiv'

type TabType = 'tags' | 'users' | 'artworks'

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('tags')

  // Pixiv 标签翻译相关状态
  const [tagInput, setTagInput] = useState('')
  const [tagList, setTagList] = useState<string[]>([])
  const [taskStats, setTaskStats] = useState<TaskStats>({
    total: 0,
    completed: 0,
    successful: 0,
    failed: 0,
    pending: 0
  })
  const [taskStatus, setTaskStatus] = useState({ isRunning: false, isPaused: false })
  const [logs, setLogs] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, isDownloading: false })

  const tabs = [
    { id: 'tags' as TabType, label: '标签页', icon: '🏷️' },
    { id: 'users' as TabType, label: '用户页', icon: '👤' },
    { id: 'artworks' as TabType, label: '作品页', icon: '🎨' }
  ]

  // 加载初始数据
  useEffect(() => {
    loadProgress()
  }, [])

  const loadProgress = async () => {
    try {
      const stats = await pixivTagService.getProgress()
      setTaskStats(stats)
      const status = pixivTagService.getTaskStatus()
      setTaskStatus(status)
    } catch (error) {
      addLog(`加载进度失败: ${error}`)
    }
  }

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]) // 保留最新50条
  }

  const handleAddTags = async () => {
    if (!tagInput.trim()) return

    const tags = tagInput
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => tag)
    if (tags.length === 0) return

    try {
      await pixivTagService.addTagNames(tags)
      setTagList((prev) => [...new Set([...prev, ...tags])])
      setTagInput('')
      addLog(`成功添加 ${tags.length} 个标签`)
      await loadProgress()
    } catch (error) {
      addLog(`添加标签失败: ${error}`)
    }
  }

  const handleStartTask = async () => {
    try {
      addLog('开始抓取任务...')
      setTaskStatus((prev) => ({ ...prev, isRunning: true }))

      await pixivTagService.runTask((stats) => {
        setTaskStats(stats)
        addLog(`进度更新: ${stats.completed}/${stats.total} (成功: ${stats.successful}, 失败: ${stats.failed})`)
      })

      addLog('任务完成或已暂停')
      await loadProgress()
    } catch (error) {
      addLog(`任务执行失败: ${error}`)
    } finally {
      setTaskStatus((prev) => ({ ...prev, isRunning: false }))
    }
  }

  const handlePauseTask = () => {
    pixivTagService.pauseTask()
    addLog('请求暂停任务...')
    setTaskStatus((prev) => ({ ...prev, isPaused: true }))
  }

  const handleGenerateSQL = async () => {
    try {
      await pixivTagService.generateUpdateSQL()
      addLog('SQL文件生成成功')
    } catch (error) {
      addLog(`SQL生成失败: ${error}`)
    }
  }

  const handleClearProgress = async () => {
    if (!confirm('确定要清除所有进度吗？此操作不可恢复。')) return

    try {
      await pixivTagService.clearProgress()
      setTagList([])
      setTaskStats({ total: 0, completed: 0, successful: 0, failed: 0, pending: 0 })
      addLog('进度已清除')
    } catch (error) {
      addLog(`清除进度失败: ${error}`)
    }
  }

  const handleDownloadImages = async () => {
    try {
      setDownloadProgress({ current: 0, total: 0, isDownloading: true })
      addLog('开始下载标签封面图...')

      await pixivTagService.downloadTagImages((current, total) => {
        setDownloadProgress({ current, total, isDownloading: true })
        addLog(`图片下载进度: ${current}/${total}`)
      })

      addLog('标签封面图下载完成')
    } catch (error) {
      addLog(`图片下载失败: ${error}`)
    } finally {
      setDownloadProgress((prev) => ({ ...prev, isDownloading: false }))
    }
  }

  const renderTagsContent = () => (
    <div className="pixiv-tag-translator">
      <div className="section">
        <h3>Pixiv 标签翻译抓取器</h3>

        {/* 进度统计 */}
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">总计:</span>
            <span className="stat-value">{taskStats.total}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">已完成:</span>
            <span className="stat-value">{taskStats.completed}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">成功:</span>
            <span className="stat-value success">{taskStats.successful}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">失败:</span>
            <span className="stat-value error">{taskStats.failed}</span>
          </div>
        </div>

        {/* 标签输入 */}
        <div className="input-section">
          <label htmlFor="tag-input">添加标签 (每行一个):</label>
          <textarea
            id="tag-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="例如:&#10;Genshin Impact&#10;原神&#10;..."
            rows={4}
          />
          <button onClick={handleAddTags} disabled={!tagInput.trim()}>
            添加标签
          </button>
        </div>

        {/* 任务控制 */}
        <div className="control-section">
          <button onClick={handleStartTask} disabled={taskStatus.isRunning} className="primary">
            {taskStatus.isRunning ? '运行中...' : '开始抓取'}
          </button>
          <button onClick={handlePauseTask} disabled={!taskStatus.isRunning}>
            暂停任务
          </button>
          <button onClick={handleGenerateSQL}>生成SQL文件</button>
          <button
            onClick={handleDownloadImages}
            disabled={downloadProgress.isDownloading || taskStats.successful === 0}
          >
            {downloadProgress.isDownloading
              ? `下载中 ${downloadProgress.current}/${downloadProgress.total}`
              : '下载封面图'}
          </button>
          <button onClick={handleClearProgress} className="danger">
            清除进度
          </button>
        </div>

        {/* 日志显示 */}
        <div className="logs-section">
          <h4>运行日志</h4>
          <div className="logs-container">
            {logs.length === 0 ? (
              <div className="no-logs">暂无日志</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="log-item">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'tags':
        return renderTagsContent()
      case 'users':
        return (
          <div className="tab-content">
            <h3>用户管理</h3>
            <div className="content-placeholder">
              <p>用户页内容区域</p>
              <p>这里将显示用户相关的功能</p>
            </div>
          </div>
        )
      case 'artworks':
        return (
          <div className="tab-content">
            <h3>作品管理</h3>
            <div className="content-placeholder">
              <p>作品页内容区域</p>
              <p>这里将显示作品相关的功能</p>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="app-container">
      <div className="tab-navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="tab-content-container">{renderTabContent()}</div>
    </div>
  )
}
