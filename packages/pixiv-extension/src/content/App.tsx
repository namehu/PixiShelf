import React, { useEffect } from 'react'
import { FloatingPanel } from './components/FloatingPanel'
import { TabNavigation } from './components/TabNavigation'
import { TagManager } from './components/TagManager'
import { TaskController } from './components/TaskController'
import { ProgressDisplay } from './components/ProgressDisplay'
import { LogViewer } from './components/LogViewer'
import { useAppStore } from './stores/appStore'
import { useUIStore } from './stores/uiStore'
import { useTaskStore } from './stores/taskStore'
import ContentPixivService from './services/ContentPixivService'

const App: React.FC = () => {
  const { isInitialized, error, isLoading, initializeApp } = useAppStore()
  const { activeTab, initializePosition } = useUIStore()
  const { setTaskStats } = useTaskStore()

  // 初始化应用
  useEffect(() => {
    const init = async () => {
      await initializeApp()
      await initializePosition()

      // 加载初始进度
      try {
        const stats = await ContentPixivService.getProgress()
        setTaskStats(stats)
      } catch (error) {
        console.warn('Failed to load initial progress:', error)
      }
    }

    init()
  }, [initializeApp, initializePosition, setTaskStats])

  // 渲染标签页内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'tags':
        return (
          <div className="tags-content">
            <ProgressDisplay />
            <TagManager />
            <TaskController />
            <LogViewer />
          </div>
        )
      case 'users':
        return (
          <div className="users-content">
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333' }}>用户管理</h3>
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: '#666',
                backgroundColor: '#f8f9fa',
                borderRadius: '4px'
              }}
            >
              <p>用户页内容区域</p>
              <p>这里将显示用户相关的功能</p>
            </div>
          </div>
        )
      case 'artworks':
        return (
          <div className="artworks-content">
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#333' }}>作品管理</h3>
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: '#666',
                backgroundColor: '#f8f9fa',
                borderRadius: '4px'
              }}
            >
              <p>作品页内容区域</p>
              <p>这里将显示作品相关的功能</p>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  // 如果正在加载
  if (isLoading) {
    return (
      <FloatingPanel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            color: '#666'
          }}
        >
          <div>正在初始化...</div>
        </div>
      </FloatingPanel>
    )
  }

  // 如果有错误
  if (error) {
    return (
      <FloatingPanel>
        <div
          style={{
            padding: '20px',
            textAlign: 'center',
            color: '#dc3545'
          }}
        >
          <h3 style={{ margin: '0 0 12px 0', color: '#dc3545' }}>初始化失败</h3>
          <p>{error}</p>
        </div>
      </FloatingPanel>
    )
  }

  // 如果未初始化
  if (!isInitialized) {
    return null
  }

  return (
    <FloatingPanel>
      <TabNavigation />
      <div className="tab-content-container" style={{ padding: '16px' }}>
        {renderTabContent()}
      </div>
    </FloatingPanel>
  )
}

export default App
