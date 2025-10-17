import React, { useEffect, useRef } from 'react'
import { useUIStore } from '../stores/uiStore'

export const ToggleButton: React.FC = () => {
  const { isVisible, toggleVisibility } = useUIStore()
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 设置按钮的初始位置和样式
  useEffect(() => {
    if (buttonRef.current) {
      // 确保按钮在页面顶层
      buttonRef.current.style.position = 'fixed'
      buttonRef.current.style.zIndex = '9999'
    }
  }, [])

  return (
    <button
      ref={buttonRef}
      onClick={toggleVisibility}
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '50px',
        height: '50px',
        borderRadius: '50%',
        backgroundColor: isVisible ? '#0066cc' : '#333',
        color: 'white',
        border: 'none',
        cursor: 'pointer',
        fontSize: '20px',
        fontWeight: 'bold',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        transition: 'all 0.3s ease',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.1)'
        e.currentTarget.style.backgroundColor = isVisible ? '#0052a3' : '#555'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.backgroundColor = isVisible ? '#0066cc' : '#333'
      }}
      title={isVisible ? '关闭 PixiShelf' : '打开 PixiShelf'}
    >
      {isVisible ? '✕' : 'P'}
    </button>
  )
}