import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
// import path from 'path'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()]
    // resolve: {
    //   alias: {
    //     '@': path.resolve(__dirname, './') // or "./src" if using src directory
    //   }
    // }
  }),
  manifest: {
    host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
    permissions: ['downloads', 'contentSettings', 'activeTab', 'storage', 'tabs']
  }
})
