import React from 'react'
import { useUIStore } from '../stores/uiStore'

interface Tab {
  id: 'tags' | 'users' | 'artworks'
  label: string
  icon: string
}

const tabs: Tab[] = [
  { id: 'tags', label: '标签', icon: '🏷️' },
  { id: 'users', label: '用户', icon: '👤' },
  { id: 'artworks', label: '作品', icon: '🎨' }
]

export const TabNavigation: React.FC = () => {
  const { activeTab, setActiveTab } = useUIStore()

  return (
    <div
      className="tab-navigation"
      style={{
        display: 'flex',
        borderBottom: '1px solid #e0e0e0'
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          style={{
            flex: 1,
            padding: '12px 8px',
            border: 'none',
            backgroundColor: activeTab === tab.id ? '#0066cc' : 'transparent',
            color: activeTab === tab.id ? 'white' : '#666',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            transition: 'all 0.2s ease',
            borderBottom: activeTab === tab.id ? '2px solid #0066cc' : '2px solid transparent'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '16px' }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
