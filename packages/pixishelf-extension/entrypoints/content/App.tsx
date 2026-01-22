import React, { useEffect } from 'react'
import { FloatingPanel } from './components/FloatingPanel'
import { TabNavigation } from './components/TabNavigation'
import { TaskController } from './components/TaskController'
import { ProgressDisplay } from './components/ProgressDisplay'
import { LogViewer } from './components/LogViewer'
import { useAppStore } from './stores/appStore'
import { useUIStore } from './stores/uiStore'
import { SettingContent } from './components/setting-content'
import UserContent from './components/user-content'

import ArtworkContent from './components/artwork-content'

const App: React.FC = () => {
  const { isInitialized, error, isLoading, initializeApp } = useAppStore()
  const { activeTab } = useUIStore()

  useEffect(() => {
    initializeApp()
  }, [])

  // 渲染标签页内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'tags':
        return (
          <div className="tags-content">
            <TaskController />
            <ProgressDisplay />
            <LogViewer />
          </div>
        )
      case 'users':
        return <UserContent />
      case 'artworks':
        return (
          <div className="artworks-content">
            <ArtworkContent />
          </div>
        )
      case 'setting':
        return (
          <div className="setting-content">
            <SettingContent />
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
      <div className="tab-content-container p-4">{renderTabContent()}</div>
    </FloatingPanel>
  )
}

export default App
