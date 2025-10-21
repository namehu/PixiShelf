import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
    permissions: ['downloads', 'contentSettings', 'activeTab', 'storage', 'tabs']
  }
})
