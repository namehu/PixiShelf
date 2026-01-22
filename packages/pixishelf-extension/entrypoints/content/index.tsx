// oxlint-disable no-console
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import tailwindStyles from '@/assets/tailwind.css?inline'
import { ShadowRootContext } from '@/lib/shadow-root-context'
import { ToggleButton } from './components/ToggleButton'
import App from './App'

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
        // Replace :root with :host to ensure variables are available in Shadow DOM
        style.textContent = tailwindStyles.replaceAll(':root', ':host')
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
              <div
                id="pixiv-extension-root"
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 0 // Lower z-index to allow portals (z-50) to appear on top
                }}
              >
                <div style={{ pointerEvents: 'auto' }}>
                  <ToggleButton />
                  <App />
                </div>
              </div>
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
