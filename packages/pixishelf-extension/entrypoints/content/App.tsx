import React, { useEffect } from 'react'
import { FloatingPanel } from './components/FloatingPanel'
import { TabNavigation } from './components/TabNavigation'
import { useAppStore } from './stores/appStore'
import { useUIStore } from './stores/uiStore'

import TagTaskContent from './components/tag-content'
import UserContent from './components/user-content'
import ArtworkContent from './components/artwork-content'
import { SettingContent } from './components/setting-content'
import { useShallow } from 'zustand/shallow'

const App: React.FC = () => {
  const { isInitialized, error, isLoading, initializeApp } = useAppStore(
    useShallow((state) => ({
      isInitialized: state.isInitialized,
      error: state.error,
      isLoading: state.isLoading,
      initializeApp: state.initializeApp
    }))
  )
  const activeTab = useUIStore((state) => state.activeTab)

  useEffect(() => {
    initializeApp()
  }, [])

  // 渲染标签页内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'tags':
        return <TagTaskContent />
      case 'users':
        return <UserContent />
      case 'artworks':
        return <ArtworkContent />
      case 'setting':
        return <SettingContent />
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
