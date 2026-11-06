import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@pixishelf/job-contracts': fileURLToPath(new URL('../pixishelf-job-contracts/src/index.ts', import.meta.url))
    }
  },
  test: {
    // Independent fixtures share the catalog lock and the single writer lane.
    fileParallelism: false
  }
})
