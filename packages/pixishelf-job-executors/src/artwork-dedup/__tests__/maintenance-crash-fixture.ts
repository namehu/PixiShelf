import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  PrismaClient,
  claimArtworkDedupOperationReader,
  recordArtworkDedupOperationReaderOwner,
  type Prisma
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { DedupReaderSupervisor } from '../reader.ts'
import { prepareArtworkInventory, type DedupPrepareContext } from '../maintenance-prepare.ts'

const database = new PrismaClient({ datasourceUrl: process.env.QUEUE_KERNEL_TEST_DATABASE_URL! })
const clock = new MutableQueueClock(new Date(process.env.DEDUP_TEST_CLOCK!))
const repository = new PostgresQueueRepository(database as unknown as QueueDatabase, { clock })
const job = await database.systemJob.findUniqueOrThrow({ where: { id: process.env.DEDUP_TEST_JOB_ID! } })
const payload = job.payload as { operationId: string; executionVersion: number }
const execution = { ...payload, jobId: job.id }
const fence = { jobId: job.id, workerId: job.workerId!, executionToken: job.leaseToken!, attempt: job.attempt }
const transaction: DedupPrepareContext['transaction'] = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) =>
  repository.withFencedMutationTransaction<Prisma.TransactionClient & QueueSqlExecutor, T>(fence, action)
const readerToken = randomUUID()
await transaction((tx) => claimArtworkDedupOperationReader(tx, { execution, readerToken }))
const require = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const reader = new DedupReaderSupervisor({
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', require.resolve('tsx')]
}).create()
const owner = await reader.start()
await transaction((tx) => recordArtworkDedupOperationReaderOwner(tx, { execution, readerToken, owner }))
const signal = new AbortController().signal
const roots = await reader.resolveRoots(
  {
    operation: 'roots',
    sourceRoot: process.env.DEDUP_TEST_ROOT!,
    archiveRoot: process.env.DEDUP_TEST_ROOT!,
    expectedPixivRootIdentity: null
  },
  signal
)
const item = await database.artworkDedupOperationArtwork.findFirstOrThrow({
  where: { operationId: payload.operationId },
  orderBy: { artworkId: 'asc' }
})
await prepareArtworkInventory({ execution, transaction, roots, reader, signal, shouldYield: () => true }, item)
process.send?.({ type: 'checkpoint' })
// The parent deliberately kills this Worker here: no finally path can release its durable reader.
await new Promise(() => undefined)
