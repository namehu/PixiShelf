import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
  define: {
    // 确保环境变量在构建时被正确替换
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:3002'),
  },
})