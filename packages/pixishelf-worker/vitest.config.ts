import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@pixishelf/db': fileURLToPath(new URL('../pixishelf-db/src/index.ts', import.meta.url)),
      '@pixishelf/job-contracts': fileURLToPath(new URL('../pixishelf-job-contracts/src/index.ts', import.meta.url)),
      '@pixishelf/job-executors': fileURLToPath(new URL('../pixishelf-job-executors/src/index.ts', import.meta.url)),
      '@pixishelf/job-runtime': fileURLToPath(new URL('../pixishelf-job-runtime/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    // PostgreSQL suites share the writer lane and its global advisory lock.
    // Keep files serial; concurrency tests still run their own competing clients.
    fileParallelism: false,
    include: ['src/__tests__/**/*.test.ts']
  }
})
