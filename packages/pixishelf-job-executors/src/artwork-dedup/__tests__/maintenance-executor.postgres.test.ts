import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertArtworkDedupMaintenanceModeEnabled, type ArtworkDedupMaintenancePayload } from '@pixishelf/job-contracts'
import { executeArtworkDedupMaintenance, type ArtworkDedupMaintenanceDependencies } from '../maintenance-executor.ts'
import { DedupReaderError, DedupReaderSupervisor } from '../reader.ts'
import { releaseExitedDedupReader } from '../reader-latch.ts'
import {
  db,
  url,
  root,
  fixture,
  readerOptions,
  clock,
  repository,
  executionContext
} from './maintenance-executor-fixture.ts'

vi.mock('@pixishelf/job-contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pixishelf/job-contracts')>()
  return { ...actual, assertArtworkDedupMaintenanceModeEnabled: vi.fn(actual.assertArtworkDedupMaintenanceModeEnabled) }
})
const actualContracts = await vi.importActual<typeof import('@pixishelf/job-contracts')>('@pixishelf/job-contracts')
const capabilities = [
  {
    jobType: 'ARTWORK_DEDUP_MAINTENANCE' as const,
    executionLane: 'BACKGROUND_WRITER' as const,
    definitionVersions: [1]
  }
]
const dependencies = (
  extra: Partial<ArtworkDedupMaintenanceDependencies> = {}
): ArtworkDedupMaintenanceDependencies => ({
  database: db!,
  sourceRoot: root,
  archiveRoot: root,
  readerOptions,
  now: () => clock.now().getTime(),
  ...extra
})
const context = (job: Parameters<typeof executionContext>[0]) => executionContext<ArtworkDedupMaintenancePayload>(job)
beforeEach(() => {
  vi.mocked(assertArtworkDedupMaintenanceModeEnabled).mockImplementation(() => undefined)
})

describe.skipIf(!db)('PREPARE Worker orchestration with real database and reader', () => {
  it('keeps the production PURGE gate closed before claiming or spawning a media reader', async () => {
    const f = await fixture()
    try {
      await f.detachReader()
      const payload: ArtworkDedupMaintenancePayload = {
        operationId: f.context.execution.operationId,
        executionVersion: f.context.execution.executionVersion,
        mode: 'PURGE'
      }
      await db!.artworkDedupOperation.update({
        where: { id: f.context.execution.operationId },
        data: { mode: 'PURGE', originalAction: 'PURGE', status: 'PURGING' }
      })
      await db!.systemJob.update({ where: { id: f.job.id }, data: { payload } })
      vi.mocked(assertArtworkDedupMaintenanceModeEnabled).mockImplementation(
        actualContracts.assertArtworkDedupMaintenanceModeEnabled
      )
      const supervisor = new DedupReaderSupervisor(readerOptions),
        create = vi.spyOn(supervisor, 'create')
      await executeArtworkDedupMaintenance({ ...context(f.job), payload }, dependencies({ supervisor }))
      expect(create).not.toHaveBeenCalled()
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({
        status: 'RECOVERY_REQUIRED',
        errorCode: 'ARTWORK_DEDUP_MODE_DISABLED',
        readerToken: null,
        preparedFiles: 0n
      })
    } finally {
      await f.close()
    }
  }, 20000)
  it('executes all readonly stages and atomically completes a ready preview', async () => {
    const f = await fixture(2)
    try {
      await f.detachReader()
      await executeArtworkDedupMaintenance(context(f.job), dependencies())
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({
        status: 'READY',
        stage: 'DONE',
        preparedArtworks: 2,
        preparedFiles: 4n,
        logicalBytes: 16n,
        readerToken: null
      })
      expect(await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ status: 'COMPLETED' })
    } finally {
      await f.close()
    }
  }, 20000)
  it('yields at a source file byte boundary with the same attempt and a three-second cooldown', async () => {
    const f = await fixture(1, 'PIXIV_SCAN')
    try {
      await f.detachReader()
      let reads = 0
      const deps = dependencies({
        sliceBytes: 1n,
        onMeasurement: (metric) => {
          reads += metric.reads
        }
      })
      await executeArtworkDedupMaintenance(context(f.job), deps)
      expect(await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({
        status: 'RETRY_WAIT',
        attempt: 0,
        availableAt: new Date(clock.now().getTime() + 3000),
        effectivePriority: 900
      })
      expect(await repository!.claim('early', capabilities)).toBeNull()
      expect(
        (await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } }))
          .preparedFiles
      ).toBe(2n)
      for (let n = 0; n < 4; n++) {
        clock.advance(3000)
        const next = await repository!.claim('resume', capabilities)
        expect(next?.id).toBe(f.job.id)
        await executeArtworkDedupMaintenance(context(next!), deps)
        if ((await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).status === 'COMPLETED') break
      }
      expect(reads).toBe(2)
      expect(
        (await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })).status
      ).toBe('READY')
    } finally {
      await f.close()
    }
  }, 20000)
  it('persists a media cursor on the ten-second budget with only aggregate progress', async () => {
    const f = await fixture(51)
    try {
      await f.detachReader()
      const supervisor = new DedupReaderSupervisor(readerOptions),
        original = supervisor.create.bind(supervisor)
      let movedClock = false
      supervisor.create = () => {
        const reader = original(),
          inspect = reader.inspectMaintenance.bind(reader)
        reader.inspectMaintenance = async (input) => {
          const result = await inspect(input)
          if (!movedClock) {
            movedClock = true
            clock.advance(10000)
          }
          return result
        }
        return reader
      }
      await executeArtworkDedupMaintenance(context(f.job), dependencies({ supervisor }))
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe('RETRY_WAIT')
      expect(
        await db!.artworkDedupOperationFile.count({ where: { operationId: f.context.execution.operationId } })
      ).toBe(4)
      expect(await db!.systemJobEvent.count({ where: { jobId: f.job.id, type: 'job.progress' } })).toBeLessThanOrEqual(
        1
      )
      clock.advance(3000)
      const next = await repository!.claim('resume', capabilities)
      await executeArtworkDedupMaintenance(context(next!), dependencies())
      expect(
        (await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })).status
      ).toBe('READY')
    } finally {
      await f.close()
    }
  }, 30000)
  it.each(['PAUSING', 'CANCELLING'] as const)(
    'honors %s during a stat without accepting that page',
    async (status) => {
      const f = await fixture()
      try {
        await f.detachReader()
        const controller = new AbortController(),
          ctx = { ...context(f.job), signal: controller.signal }
        const supervisor = new DedupReaderSupervisor(readerOptions),
          original = supervisor.create.bind(supervisor)
        supervisor.create = () => {
          const reader = original(),
            inspect = reader.inspectMaintenance.bind(reader)
          reader.inspectMaintenance = async (input) => {
            const result = await inspect(input)
            await db!.systemJob.update({ where: { id: f.job.id }, data: { status } })
            controller.abort(new Error(status))
            return result
          }
          return reader
        }
        await executeArtworkDedupMaintenance(ctx, dependencies({ supervisor }))
        expect(await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({
          status: status === 'PAUSING' ? 'PAUSED' : 'CANCELLED'
        })
        expect(
          await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
        ).toMatchObject({ readerToken: null, preparedFiles: 0n })
      } finally {
        await f.close()
      }
    },
    20000
  )
  it('finishes a stale preview when membership changes after the file was observed', async () => {
    const f = await fixture()
    try {
      await f.detachReader()
      const supervisor = new DedupReaderSupervisor(readerOptions),
        original = supervisor.create.bind(supervisor)
      supervisor.create = () => {
        const reader = original(),
          inspect = reader.inspectMaintenance.bind(reader)
        reader.inspectMaintenance = async (input) => {
          const result = await inspect(input)
          await db!.image.create({ data: { artworkId: f.ids[0]!, path: `${randomUUID()}.bin`, size: 8n } })
          return result
        }
        return reader
      }
      await executeArtworkDedupMaintenance(context(f.job), dependencies({ supervisor }))
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({ status: 'STALE', errorCode: 'SNAPSHOT_CHANGED', preparedFiles: 0n, readerToken: null })
    } finally {
      await f.close()
    }
  }, 20000)
  it('rejects a changed effective root mapping before reading a file', async () => {
    const f = await fixture()
    try {
      await f.detachReader()
      const archive = path.join(root, 'new-archive')
      await fs.mkdir(archive, { recursive: true })
      let inspected = 0
      await executeArtworkDedupMaintenance(
        context(f.job),
        dependencies({
          archiveRoot: archive,
          onMeasurement: (metrics) => {
            inspected = metrics.inspections
          }
        })
      )
      expect(inspected).toBe(0)
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({ status: 'FAILED', errorCode: 'ROOT_CHANGED', readerToken: null })
    } finally {
      await f.close()
    }
  }, 20000)
  it('refuses stale lease results and only clears its closed reader token', async () => {
    const f = await fixture()
    try {
      await f.detachReader()
      const supervisor = new DedupReaderSupervisor(readerOptions),
        original = supervisor.create.bind(supervisor)
      supervisor.create = () => {
        const reader = original(),
          inspect = reader.inspectMaintenance.bind(reader)
        reader.inspectMaintenance = async (input) => {
          const result = await inspect(input)
          await db!.systemJob.update({ where: { id: f.job.id }, data: { leaseToken: randomUUID() } })
          return result
        }
        return reader
      }
      await expect(executeArtworkDedupMaintenance(context(f.job), dependencies({ supervisor }))).rejects.toThrow()
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({ preparedFiles: 0n, readerToken: null })
    } finally {
      await f.close()
    }
  }, 20000)
  it('resumes the same durable media checkpoint after a real Worker SIGKILL without a finally release', async () => {
    const f = await fixture(5)
    let child: ReturnType<typeof spawn> | undefined
    try {
      await f.detachReader()
      child = spawn(
        process.execPath,
        [...readerOptions.execArgv, new URL('./maintenance-crash-fixture.ts', import.meta.url).pathname],
        {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          serialization: 'advanced',
          env: {
            ...process.env,
            QUEUE_KERNEL_TEST_DATABASE_URL: url!,
            DEDUP_TEST_CLOCK: clock.now().toISOString(),
            DEDUP_TEST_JOB_ID: f.job.id,
            DEDUP_TEST_ROOT: root
          }
        }
      )
      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-3000)
      })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No crash checkpoint: ' + stderr)), 10000)
        child!.once('message', () => {
          clearTimeout(timer)
          resolve()
        })
        child!.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child!.once('exit', () => {
          clearTimeout(timer)
          reject(new Error('Crash fixture exited early: ' + stderr))
        })
      })
      const before = await db!.artworkDedupOperation.findUniqueOrThrow({
        where: { id: f.context.execution.operationId }
      })
      expect(before).toMatchObject({ preparedFiles: 4n, readerState: 'ACTIVE' })
      expect(before.readerToken).not.toBeNull()
      const close = new Promise<void>((resolve) => child!.once('close', () => resolve()))
      child.kill('SIGKILL')
      await close
      clock.advance(61000)
      await repository!.recoverExpiredExecution()
      const next = await repository!.claim('restart', capabilities)
      expect(next?.id).toBe(f.job.id)
      let inspections = 0
      await executeArtworkDedupMaintenance(
        context(next!),
        dependencies({
          onMeasurement: (metrics) => {
            inspections = metrics.inspections
          }
        })
      )
      expect(await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
        status: 'READY',
        preparedFiles: 10n,
        readerToken: null
      })
      // Six remaining inventory stats + ten registered-file checks + two directory confirmations.
      expect(inspections).toBe(18)
    } finally {
      child?.kill('SIGKILL')
      await f.close()
    }
  }, 30000)
  it('retains ACTION_REQUIRED on missing close acknowledgement and clears only after an independent exit proof', async () => {
    const f = await fixture()
    try {
      await f.detachReader()
      const supervisor = new DedupReaderSupervisor(readerOptions),
        original = supervisor.create.bind(supervisor)
      supervisor.create = () => {
        const reader = original(),
          close = reader.close.bind(reader)
        reader.close = async (reason) => {
          await close(reason)
          throw new DedupReaderError('READER_CLOSE_FAILED')
        }
        return reader
      }
      await executeArtworkDedupMaintenance(context(f.job), dependencies({ supervisor }))
      expect(await db!.systemJob.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({
        status: 'PAUSED'
      })
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({ status: 'BUILDING', readerState: 'BLOCKED', errorCode: 'READER_CLOSE_FAILED' })
      expect(
        (await db!.systemJobEvent.findFirstOrThrow({ where: { jobId: f.job.id, type: 'job.paused' } })).data
      ).toMatchObject({ reason: 'ACTION_REQUIRED' })
      await releaseExitedDedupReader(db!, readerOptions)
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
      ).toMatchObject({ readerState: 'IDLE', readerToken: null })
    } finally {
      await f.close()
    }
  }, 20000)
})
