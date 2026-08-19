import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.next/**'
    ],
    alias: {
      '@': path.resolve(__dirname, './'),
      '@pixishelf/job-contracts': path.resolve(__dirname, '../pixishelf-job-contracts/src/index.ts'),
      '@pixishelf/job-executors': path.resolve(__dirname, '../pixishelf-job-executors/src/index.ts'),
      '@pixishelf/job-runtime': path.resolve(__dirname, '../pixishelf-job-runtime/src/index.ts'),
      'server-only': path.resolve(__dirname, './tests/mocks/server-only.ts')
    }
    // globals: true, // 如果需要全局变量
  }
})
