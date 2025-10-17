import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppContainer } from './components/AppContainer'

console.log('[CRXJS] Pixiv Extension Content Script Loaded!')

// 初始化应用
const initializeApp = () => {
  // 检查是否在Pixiv页面
  if (!window.location.hostname.includes('pixiv.net')) {
    console.log('[CRXJS] Not on Pixiv, skipping initialization')
    return
  }

  // 避免重复初始化
  if (document.getElementById('pixiv-extension-root')) {
    console.log('[CRXJS] Extension already initialized')
    return
  }

  // 创建临时容器用于React渲染
  const tempContainer = document.createElement('div')
  document.body.appendChild(tempContainer)

  // 渲染应用
  const root = createRoot(tempContainer)
  root.render(
    <StrictMode>
      <AppContainer />
    </StrictMode>
  )

  console.log('[CRXJS] Extension initialized successfully')
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp)
} else {
  initializeApp()
}
