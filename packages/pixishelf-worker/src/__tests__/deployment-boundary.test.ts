import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repositoryRoot = new URL('../../../..', import.meta.url)

describe('Worker deployment boundary', () => {
  it.each(['docker-compose.dev.yml', 'docker-compose.deploy.yml'])(
    'keeps the new Worker in safe dark launch beside the transitional archive consumer in %s',
    (filename) => {
      const compose = readFileSync(new URL(`build/${filename}`, repositoryRoot), 'utf8')
      expect(compose).toMatch(/^  archive-worker:/m)
      expect(compose).toContain('dist/archive-worker.cjs')
      const worker = compose.match(/^  worker:\r?\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\r?$)/m)?.[0]
      expect(worker).toBeDefined()
      expect(worker).toMatch(/depends_on:\s*\r?\n\s+postgres:/)
      expect(worker).not.toMatch(/depends_on:\s*\r?\n\s+app:/)
      expect(worker).toContain('WORKER_DISPATCH_ENABLED: ${WORKER_DISPATCH_ENABLED:-false}')
      expect(worker).toContain('WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS: ${WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS:-5000}')
      expect(worker).toContain('WORKER_QUEUE_TRANSACTION_TIMEOUT_MS: ${WORKER_QUEUE_TRANSACTION_TIMEOUT_MS:-30000}')
      expect(worker).toContain(':/app/data:rw')
      expect(worker).toContain('stop_grace_period: 45s')
      expect(worker).toMatch(/max-size: ['"]10m['"]/)
      expect(worker).toMatch(/max-file: ['"]5['"]/)
    }
  )

  it('continues to build and scan both Worker images until the atomic cutover', () => {
    const workflow = readFileSync(new URL('.github/workflows/build-and-deploy.yml', repositoryRoot), 'utf8')
    expect(workflow).toContain('file: ./build/worker.Dockerfile')
    expect(workflow).toContain('file: ./build/archive-worker.Dockerfile')
    expect(workflow).toContain('pixishelf-archive-worker')
    expect(workflow).not.toContain('worker-preview')
  })

  it('installs FFmpeg and FFprobe in the production Worker image', () => {
    const dockerfile = readFileSync(new URL('build/worker.Dockerfile', repositoryRoot), 'utf8')
    expect(dockerfile).toContain('COPY packages/pixishelf-job-executors')
    const productionStage = dockerfile.slice(dockerfile.indexOf('FROM node:20-alpine AS production'))
    expect(productionStage).toContain('apk add --no-cache openssl ffmpeg tini')
  })

  it('packages the shared job contracts required by the transitional archive worker', () => {
    const dockerfile = readFileSync(new URL('build/archive-worker.Dockerfile', repositoryRoot), 'utf8')
    expect(dockerfile).toContain('COPY packages/pixishelf-job-contracts/package.json')
    expect(dockerfile).toContain('COPY packages/pixishelf-job-contracts ./packages/pixishelf-job-contracts')
    expect(dockerfile).toContain('pnpm --filter @pixishelf/job-contracts build')
  })

  it('ships the read-only 17-capability release audit and documents it as a deployment gate', () => {
    const buildScript = readFileSync(new URL('packages/pixishelf-worker/scripts/build.mjs', repositoryRoot), 'utf8')
    const runbook = readFileSync(new URL('docs/design/background-task-runbook.md', repositoryRoot), 'utf8')
    expect(buildScript).toContain("'capability-audit': 'src/capability-audit.ts'")
    expect(runbook).toContain('node dist/capability-audit.cjs')
  })
})
