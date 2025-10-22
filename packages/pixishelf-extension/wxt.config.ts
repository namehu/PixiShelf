import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()]
  }),
  manifest: {
    host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
    permissions: ['downloads', 'contentSettings', 'activeTab', 'storage', 'tabs']
  }
})
