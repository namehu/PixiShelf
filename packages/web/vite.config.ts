import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5430,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5431',
        changeOrigin: true
      }
    }
  },
  define: {
    // 确保环境变量在构建时被正确替换
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:5431')
  }
})
