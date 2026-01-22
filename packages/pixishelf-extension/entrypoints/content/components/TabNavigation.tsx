import React from 'react'
import { useUIStore } from '../stores/uiStore'
import { cn } from '@/lib/utils'
import { TabId } from '../stores/uiStore'

interface Tab {
  id: TabId
  label: string
  icon: string
}

const tabs: Tab[] = [
  { id: 'tags', label: '标签', icon: '🏷️' },
  { id: 'users', label: '用户', icon: '👤' },
  { id: 'artworks', label: '作品', icon: '🎨' },
  { id: 'setting', label: '设置', icon: '⚙️' }
]

export const TabNavigation: React.FC = () => {
  const { activeTab, setActiveTab } = useUIStore()

  return (
    <div className="tab-navigation flex border-b border-[#e0e0e0]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            'flex-1 px-2 py-3 text-sm font-medium transition-all duration-200 ease-in-out cursor-pointer',
            `tab-button ${activeTab === tab.id ? 'active' : ''}`,
            activeTab === tab.id ? 'bg-[#0066cc] text-white border-[#0066cc]' : 'bg-transparent text-[#666]'
          )}
        >
          <div className="flex justify-center items-center gap-2">
            <span className="text-lg">{tab.icon}</span>
            <span className="text-sm">{tab.label}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
