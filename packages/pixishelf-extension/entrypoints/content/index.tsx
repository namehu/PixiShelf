// oxlint-disable no-console
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppContainer } from './components/AppContainer'
import { Toaster } from '@/components/ui/sonner'
import tailwindStyles from '@/assets/tailwind.css?inline'
import { ShadowRootContext } from '@/lib/shadow-root-context'

export default defineContentScript({
  matches: ['https://www.pixiv.net/*'],
  cssInjectionMode: 'manual',
  async main(ctx) {
    // 检查是否在Pixiv页面
    if (!window.location.hostname.includes('pixiv.net')) {
      console.log('[WXT] Not on Pixiv, skipping initialization')
      return
    }

    console.log('[WXT] Pixiv Extension initialized successfully')

    const ui = await createShadowRootUi(ctx, {
      name: 'pixishelf-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount: (uiContainer, shadowRoot) => {
        // 注入 Tailwind 样式
        const style = document.createElement('style')
        style.textContent = tailwindStyles
        shadowRoot.appendChild(style)

        // 在 Shadow Root 内部创建一个挂载点
        const appRoot = document.createElement('div')
        appRoot.id = 'pixishelf-app-root'
        shadowRoot.appendChild(appRoot)

        // 渲染应用到 Shadow Root 内部的挂载点
        const root = createRoot(appRoot)
        root.render(
          <StrictMode>
            {/* 将 Shadow Root 内部的挂载点提供给 Context，确保 Portal 渲染到 Shadow DOM 内部 */}
            <ShadowRootContext.Provider value={appRoot}>
              <AppContainer />
              <Toaster />
            </ShadowRootContext.Provider>
          </StrictMode>
        )
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })

    // Call mount to add the UI to the DOM
    ui.mount()
  }
})
