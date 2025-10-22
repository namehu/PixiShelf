import React, { useRef } from 'react'
import { useUIStore } from '../stores/uiStore'

export const ToggleButton: React.FC = () => {
  const { isVisible, toggleVisibility } = useUIStore()
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <button
      ref={buttonRef}
      onClick={toggleVisibility}
      className={`
        fixed top-5 right-5 w-12 h-12 rounded-full
        ${isVisible ? 'bg-blue-600' : 'bg-gray-800'}
        text-white border-none cursor-pointer
        text-xl font-bold shadow-lg
        transition-all duration-300 ease-in-out
        z-50 flex items-center justify-center
        font-sans select-none
      `}
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
