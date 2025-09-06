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
  build: {
    // 确保懒加载相关的代码在生产环境中正确工作
    target: 'es2015', // 支持更多浏览器
    minify: 'esbuild', // 使用esbuild进行压缩，避免terser依赖问题
    rollupOptions: {
      output: {
        // 确保动态导入的chunk能正确加载
        manualChunks: undefined
      }
    }
  },
  define: {
    // 确保环境变量在构建时被正确替换
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:5431')
  }
})
