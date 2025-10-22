import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppContainer } from './components/AppContainer'
import { Toaster } from '@/components/ui/sonner'

import '@/assets/tailwind.css' // Adjust the path if necessary

export default defineContentScript({
  matches: ['https://www.pixiv.net/*'],
  main(ctx) {
    // 检查是否在Pixiv页面
    if (!window.location.hostname.includes('pixiv.net')) {
      console.log('[WXT] Not on Pixiv, skipping initialization')
      return
    }

    // 避免重复初始化
    if (document.getElementById('pixiv-extension-root')) {
      console.log('[WXT] Extension already initialized')
      return
    }

    // 创建临时容器用于React渲染
    const tempContainer = document.createElement('div')
    // document.body.appendChild(tempContainer)

    // // 渲染应用
    // const root = createRoot(tempContainer)
    // root.render(
    //   <StrictMode>
    //     <AppContainer />
    //   </StrictMode>
    // )

    console.log('[WXT] Pixiv Extension initialized successfully')

    const ui = createIntegratedUi(ctx, {
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        // Append children to the container
        // const app = document.createElement('p');
        // app.textContent = '...';

        // 渲染应用
        const root = createRoot(tempContainer)
        root.render(
          <StrictMode>
            <AppContainer />
            <Toaster />
          </StrictMode>
        )
        container.append(tempContainer)
      }
    })

    // Call mount to add the UI to the DOM
    ui.mount()
  }
})
