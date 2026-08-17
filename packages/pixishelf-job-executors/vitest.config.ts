import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@pixishelf/db': fileURLToPath(new URL('../pixishelf-db/src/index.ts', import.meta.url)),
      '@pixishelf/job-contracts': fileURLToPath(new URL('../pixishelf-job-contracts/src/index.ts', import.meta.url)),
      '@pixishelf/job-runtime': fileURLToPath(new URL('../pixishelf-job-runtime/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    // PostgreSQL suites share the queue kernel's global execution fence. Keep
    // test files on one worker so independent domains cannot race for it.
    fileParallelism: false,
    include: ['src/**/__tests__/**/*.test.ts']
  }
})
