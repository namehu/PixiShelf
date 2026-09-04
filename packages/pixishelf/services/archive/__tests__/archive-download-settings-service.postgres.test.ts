import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, type Prisma } from '@pixishelf/db'
import { freezeArchiveMediaConcurrency } from '@pixishelf/job-executors'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ArchiveDownloadSettingsConflictError,
  updateArchiveDownloadSettingsInTransaction
} from '../archive-download-settings-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe.sequential : describe.skip
const suitePrefix = `archive-settings-lock-${randomUUID()}`
const appDatabase = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
const workerDatabase = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
let originalSetting: { value: string | null; type: string } | null = null

describePostgres('archive download settings PostgreSQL lock protocol', () => {
  beforeAll(async () => {
    await Promise.all([appDatabase.$connect(), workerDatabase.$connect()])
    originalSetting = await appDatabase.setting.findUnique({
      where: { key: 'archive_media_concurrency' },
      select: { value: true, type: true }
    })
  })

  beforeEach(async () => {
    await appDatabase.systemJob.deleteMany({ where: { id: { startsWith: suitePrefix } } })
    await appDatabase.setting.upsert({
      where: { key: 'archive_media_concurrency' },
      update: { value: '2', type: 'number' },
      create: { key: 'archive_media_concurrency', value: '2', type: 'number' }
    })
  })

  afterAll(async () => {
    await appDatabase.systemJob.deleteMany({ where: { id: { startsWith: suitePrefix } } })
    if (originalSetting) {
      await appDatabase.setting.upsert({
        where: { key: 'archive_media_concurrency' },
        update: originalSetting,
        create: { key: 'archive_media_concurrency', ...originalSetting }
      })
    } else {
      await appDatabase.setting.deleteMany({ where: { key: 'archive_media_concurrency' } })
    }
    await Promise.all([disconnectDatabase(appDatabase), disconnectDatabase(workerDatabase)])
  })

  it('freezes the newly saved value when the settings transaction commits first', async () => {
    const saveGate = deferred<void>()
    const saveLocked = deferred<void>()
    const save = appDatabase.$transaction(async (transaction) => {
      const settings = await updateArchiveDownloadSettingsInTransaction(
        transaction as unknown as Prisma.TransactionClient,
        4
      )
      saveLocked.resolve()
      await saveGate.promise
      return settings
    })
    await saveLocked.promise

    const freeze = workerDatabase.$transaction((transaction) =>
      freezeArchiveMediaConcurrency(transaction as unknown as Prisma.TransactionClient)
    )
    const freezeWasPending = !(await settlesWithin(freeze, 100))
    saveGate.resolve()

    await expect(save).resolves.toMatchObject({ mediaConcurrency: 4 })
    await expect(freeze).resolves.toBe(4)
    expect(freezeWasPending).toBe(true)
  })

  it('rejects a save after an executing Worker has frozen the old value first', async () => {
    const blockingJobId = `${suitePrefix}-running`
    await appDatabase.systemJob.create({
      data: {
        id: blockingJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'RUNNING',
        triggerSource: 'MANUAL',
        payload: { archiveImportId: `${suitePrefix}-import` },
        attempt: 1,
        workerId: `${suitePrefix}-worker`,
        startedAt: new Date()
      }
    })

    const workerGate = deferred<void>()
    const workerLocked = deferred<number>()
    const freeze = workerDatabase.$transaction(async (transaction) => {
      const value = await freezeArchiveMediaConcurrency(transaction as unknown as Prisma.TransactionClient)
      workerLocked.resolve(value)
      await workerGate.promise
      return value
    })
    await expect(workerLocked.promise).resolves.toBe(2)

    const save = appDatabase.$transaction((transaction) =>
      updateArchiveDownloadSettingsInTransaction(transaction as unknown as Prisma.TransactionClient, 4)
    )
    const saveWasPending = !(await settlesWithin(save, 100))
    workerGate.resolve()

    await expect(freeze).resolves.toBe(2)
    await expect(save).rejects.toEqual(
      expect.objectContaining<Partial<ArchiveDownloadSettingsConflictError>>({
        blockingSystemJobId: blockingJobId
      })
    )
    expect(saveWasPending).toBe(true)
    await expect(
      appDatabase.setting.findUniqueOrThrow({ where: { key: 'archive_media_concurrency' }, select: { value: true } })
    ).resolves.toEqual({ value: '2' })
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds))
  ])
}
