import React, { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../stores/uiStore'

interface FloatingPanelProps {
  children: React.ReactNode
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({ children }) => {
  const { isVisible, isCollapsed, position, setPosition, toggleCollapse } = useUIStore()

  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!panelRef.current) return

    const rect = panelRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    setIsDragging(true)
  }

  // 处理拖拽移动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return

      const newX = e.clientX - dragOffset.x
      const newY = e.clientY - dragOffset.y

      // 确保面板不会拖拽到屏幕外
      const maxX = window.innerWidth - 320 // 面板宽度
      const maxY = window.innerHeight - 100 // 最小高度

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset, setPosition])

  if (!isVisible) return null

  return (
    <div
      ref={panelRef}
      className="pixiv-floating-panel"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '768px',
        backgroundColor: '#ffffff',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        zIndex: 10000,
        fontSize: '14px',
        userSelect: 'none'
      }}
    >
      {/* 标题栏 */}
      <div
        className="panel-header"
        style={{
          padding: '12px 16px',
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #e0e0e0',
          borderRadius: '8px 8px 0 0',
          cursor: 'move',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
        onMouseDown={handleMouseDown}
      >
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#333' }}>PixiShelf Downloader</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={toggleCollapse}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              color: '#666',
              fontSize: '16px'
            }}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      {!isCollapsed && (
        <div
          className="panel-content"
          style={{
            maxHeight: '600px',
            overflowY: 'auto'
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
