import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_WORKER_CAPABILITIES } from '../production-capabilities.js'

const repositoryRoot = new URL('../../../..', import.meta.url)

describe('Worker deployment boundary', () => {
  it.each(['docker-compose.dev.yml', 'docker-compose.deploy.yml'])(
    'caps every long-running service at 10 MB x 5 in %s',
    (filename) => {
      const compose = readFileSync(new URL(`build/${filename}`, repositoryRoot), 'utf8')
      const services = ['postgres', 'app', 'worker', 'scheduler', 'imgproxy']
      for (const [index, service] of services.entries()) {
        const nextService = services[index + 1]
        const start = compose.indexOf(`  ${service}:`)
        const end = nextService ? compose.indexOf(`  ${nextService}:`, start) : compose.indexOf('\nvolumes:', start)
        const definition = compose.slice(start, end)
        expect(definition, service).toMatch(/driver: ['"]json-file['"]/)
        expect(definition, service).toMatch(/max-size: ['"]10m['"]/)
        expect(definition, service).toMatch(/max-file: ['"]5['"]/)
      }
    }
  )

  it.each(['docker-compose.dev.yml', 'docker-compose.deploy.yml'])(
    'does not ship the retired Thumbor service in %s',
    (filename) => {
      const compose = readFileSync(new URL(`build/${filename}`, repositoryRoot), 'utf8')
      expect(compose).not.toMatch(/^  thumbor:/m)
      expect(compose).not.toContain('NEXT_PUBLIC_THUMBOR_VIDEO_URL')
      expect(compose).not.toContain('THUMBOR_HOST_PORT')
      expect(compose).not.toContain('5433')
    }
  )

  it.each(['docker-compose.dev.yml', 'docker-compose.deploy.yml'])(
    'ships the general Worker as the only background consumer in %s',
    (filename) => {
      const compose = readFileSync(new URL(`build/${filename}`, repositoryRoot), 'utf8')
      expect(compose).not.toMatch(/^  archive-worker:/m)
      expect(compose).not.toContain('pixishelf-archive-worker')
      expect(compose).not.toContain('dist/archive-worker.cjs')
      expect(compose.match(/^  worker:/gm)).toHaveLength(1)
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

  it.each(['docker-compose.dev.yml', 'docker-compose.deploy.yml'])(
    'mounts the existing Pixiv data directory outside Next public with App read-only and Worker read-write in %s',
    (filename) => {
      const compose = readFileSync(new URL(`build/${filename}`, repositoryRoot), 'utf8')
      const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  worker:'))
      const worker = compose.slice(compose.indexOf('  worker:'), compose.indexOf('  scheduler:'))
      const containerPath = '/app/pixiv-data'
      const hostMount = '${PIXISHELF_PUBLIC_DATA_PATH:?PIXISHELF_PUBLIC_DATA_PATH is required}'

      expect(app).toContain(`PIXIV_DATA_STORAGE_PATH: ${containerPath}`)
      expect(app).toContain(`${hostMount}:${containerPath}:ro`)
      expect(worker).toContain(`PIXIV_DATA_ROOT: ${containerPath}`)
      expect(worker).toContain(`${hostMount}:${containerPath}:rw`)
      expect(compose).not.toContain('PIXIV_DATA_HOST_PATH')
      expect(compose).not.toContain('/app/packages/pixishelf/public/pixiv_data')
    }
  )

  it('builds and scans only the general Worker image after direct cutover', () => {
    const workflow = readFileSync(new URL('.github/workflows/build-and-deploy.yml', repositoryRoot), 'utf8')
    expect(workflow).toContain('file: ./build/worker.Dockerfile')
    expect(workflow).not.toContain('archive-worker.Dockerfile')
    expect(workflow).not.toContain('pixishelf-archive-worker')
    expect(workflow).not.toContain('ARCHIVE_WORKER_IMAGE_NAME')
    expect(workflow).not.toContain('worker-preview')
  })

  it('installs FFmpeg and FFprobe in the production Worker image', () => {
    const dockerfile = readFileSync(new URL('build/worker.Dockerfile', repositoryRoot), 'utf8')
    expect(dockerfile).toContain('COPY packages/pixishelf-job-executors')
    const productionStage = dockerfile.slice(dockerfile.indexOf('FROM node:20-alpine AS production'))
    expect(productionStage).toContain('apk add --no-cache openssl ffmpeg tini')
  })

  it('publishes both execution lanes from the sole production Worker', () => {
    expect(new Set(PRODUCTION_WORKER_CAPABILITIES.map(({ executionLane }) => executionLane))).toEqual(
      new Set(['ARCHIVE_RESOLVE', 'BACKGROUND_WRITER'])
    )
    expect(PRODUCTION_WORKER_CAPABILITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE' }),
        expect.objectContaining({ jobType: 'ARCHIVE_IMPORT', executionLane: 'BACKGROUND_WRITER' }),
        expect.objectContaining({ jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER' })
      ])
    )
  })

  it('removes every executable legacy consumer entrypoint', () => {
    const nextPackage = readFileSync(new URL('packages/pixishelf/package.json', repositoryRoot), 'utf8')
    for (const retiredPath of [
      'build/archive-worker.Dockerfile',
      'packages/pixishelf-archive-worker/package.json',
      'packages/pixishelf/services/archive/archive-worker.ts',
      'packages/pixishelf/services/archive/publisher.ts',
      'packages/pixishelf/services/archive/worker-control.ts',
      'packages/pixishelf/services/video-keyframe-worker.ts'
    ]) {
      expect(existsSync(new URL(retiredPath, repositoryRoot)), retiredPath).toBe(false)
    }
    expect(nextPackage).not.toContain('archive:worker')
  })

  it('ships the read-only 22-job capability audit and documents it as a deployment gate', () => {
    const buildScript = readFileSync(new URL('packages/pixishelf-worker/scripts/build.mjs', repositoryRoot), 'utf8')
    const runbook = readFileSync(new URL('docs/design/background-task-runbook.md', repositoryRoot), 'utf8')
    expect(buildScript).toContain("'capability-audit': 'src/capability-audit.ts'")
    expect(runbook).toContain('node dist/capability-audit.cjs')
  })

  it('deploys migrations before Worker readiness and starts App only after the capability gate', () => {
    const updateScript = readFileSync(new URL('scripts/update-production.sh', repositoryRoot), 'utf8')
    const migration = updateScript.indexOf('UPDATE_PHASE="deploy-migrations"')
    const worker = updateScript.indexOf('UPDATE_PHASE="start-worker"')
    const capability = updateScript.indexOf('UPDATE_PHASE="capability-audit"')
    const app = updateScript.indexOf('UPDATE_PHASE="start-app"')

    expect(updateScript).toContain('run --rm --no-deps --entrypoint prisma app')
    expect(migration).toBeGreaterThan(-1)
    expect(migration).toBeLessThan(worker)
    expect(worker).toBeLessThan(capability)
    expect(capability).toBeLessThan(app)
  })
})
