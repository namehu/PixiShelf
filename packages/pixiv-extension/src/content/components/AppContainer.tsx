import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import App from '../App'
import { ToggleButton } from './ToggleButton'

export const AppContainer: React.FC = () => {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // 临时隐藏dom元素
    const dom = document.getElementById('__next')
    console.log(dom)
    if (dom) {
      dom.style.display = 'none'
    }
    // 创建Portal容器
    const container = document.createElement('div')
    container.id = 'pixiv-extension-root'
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `

    // 添加到页面
    document.body.appendChild(container)
    setPortalContainer(container)

    // 清理函数
    return () => {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }
  }, [])

  if (!portalContainer) {
    return null
  }

  return createPortal(
    <div style={{ pointerEvents: 'auto' }}>
      <ToggleButton />
      <App />
    </div>,
    portalContainer
  )
}
