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
      className="pixiv-floating-panel fixed w-[768px] bg-white border border-[#e0e0e0] rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[10000] text-sm select-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
    >
      {/* 标题栏 */}
      <div
        className="panel-header p-2 bg-[#f5f5f5] border-b border-[#e0e0e0] rounded-t-lg cursor-move flex justify-between items-center"
        onMouseDown={handleMouseDown}
      >
        <h3 className="m-0 text-base font-semibold text-[#333]">PixiShelf Downloader</h3>
        <div className="">
          <button
            onClick={toggleCollapse}
            className="bg-transparent border-none cursor-pointer p-1 rounded text-[#666] text-base hover:bg-black/5"
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      {!isCollapsed && <div className="panel-content max-h-[700px] overflow-y-auto">{children}</div>}
    </div>
  )
}
