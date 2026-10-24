import { createRequire } from 'node:module'
import { PrismaClient } from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ExecutionContext,
  type EnqueuedChildJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup } from '../executor.ts'
import { DedupReaderSupervisor } from '../reader.ts'
const db = new PrismaClient({ datasourceUrl: process.env.QUEUE_KERNEL_TEST_DATABASE_URL! })
const clock = new MutableQueueClock(new Date(process.env.DEDUP_TEST_CLOCK!))
const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { clock })
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
const supervisor = new DedupReaderSupervisor(readerOptions)
const create = supervisor.create.bind(supervisor)
supervisor.create = () => {
  const reader = create(),
    read = reader.read.bind(reader)
  reader.read = async (input) => {
    await read(input)
    process.send?.({ type: 'read-before-commit' })
    return new Promise(() => undefined)
  }
  return reader
}
const job = await repository.claim('dedup-crash-fixture', [
  { jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
])
if (!job || job.id !== process.env.DEDUP_TEST_JOB_ID) throw new Error('Fixture claimed a different job')
const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
const context: ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> = {
  job,
  payload: job.payload as ArtworkDedupScanPayload,
  signal: new AbortController().signal,
  progress: (update) => repository.updateProgress({ ...fence, ...update }),
  enqueueChild: async () => {
    throw new Error('Unexpected child')
  },
  mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
  finalizeInTransaction: async (operation) => {
    await repository.withFencedExecutionTransaction(fence, operation)
    return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
  },
  logger: { debug() {}, info() {}, warn() {}, error() {} }
}
await executeArtworkDedup(context, {
  database: db,
  sourceRoot: process.env.DEDUP_TEST_ROOT!,
  archiveRoot: process.env.DEDUP_TEST_ROOT!,
  readerOptions,
  supervisor,
  now: () => clock.now().getTime()
})
