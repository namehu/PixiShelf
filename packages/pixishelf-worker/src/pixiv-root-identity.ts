import { createHash } from 'node:crypto'
import { createDatabaseClient, type Prisma, type PrismaClient } from '@pixishelf/db'
import {
  assertPixivRootUnchanged,
  bindPixivInventoryRoot,
  createPixivRootMarker,
  readPixivRootMarker,
  resolveSafeScanRoot,
  ScanExecutorError
} from '@pixishelf/job-executors'
import { resourceKeyForExecutionLane } from '@pixishelf/job-runtime'

type DatabaseReader = Pick<Prisma.TransactionClient, 'pixivMetadataInventoryState'>
type Command = 'inspect' | 'bind' | 'restore-marker'

export async function inspectPixivRoot(database: DatabaseReader, scanRoot: string) {
  const root = await resolveSafeScanRoot(scanRoot)
  const state = await database.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
  let marker: { status: 'VALID' | 'MISSING' | 'INVALID'; identity: string | null; error?: string }
  try {
    const identity = await readPixivRootMarker(root)
    marker = { status: identity ? 'VALID' : 'MISSING', identity }
  } catch (error) {
    if (!(error instanceof ScanExecutorError)) throw error
    marker = { status: 'INVALID', identity: null, error: error.message }
  }
  const observation = { root, state, marker }
  return { ...observation, fingerprint: createHash('sha256').update(serialize(observation)).digest('hex') }
}

export async function maintainPixivRoot(input: {
  database: PrismaClient
  scanRoot: string
  command: Exclude<Command, 'inspect'>
  expected: string
  confirmSameLibrary: boolean
}) {
  if (!input.confirmSameLibrary || !/^[a-f0-9]{64}$/.test(input.expected)) {
    throw new ScanExecutorError(
      'CONFIGURATION_INVALID',
      'Write commands require --expect <inspect fingerprint> --confirm-same-library'
    )
  }
  return input.database.$transaction(
    async (transaction) => {
      // Same lock as queue claim: no new writer can start between the idle check and commit.
      const [lock] = await transaction.$queryRawUnsafe<Array<{ locked: boolean }>>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "locked"',
        resourceKeyForExecutionLane('BACKGROUND_WRITER')
      )
      if (!lock?.locked) throw conflict('Writer scheduling is busy; stop Worker and inspect again')
      const now = new Date()
      const activeJob = await transaction.systemJob.findFirst({
        where: { executionLane: 'BACKGROUND_WRITER', status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] } },
        select: { id: true }
      })
      const lease = await transaction.jobResourceLease.findFirst({
        where: { resourceKey: resourceKeyForExecutionLane('BACKGROUND_WRITER'), expiresAt: { gt: now } },
        select: { resourceKey: true }
      })
      const worker = await transaction.workerInstance.findFirst({
        where: {
          status: { in: ['STARTING', 'READY', 'DEGRADED'] },
          heartbeatAt: { gte: new Date(now.getTime() - 60_000) }
        },
        select: { workerId: true }
      })
      if (activeJob || lease || worker)
        throw conflict('Stop Worker and wait for active jobs, leases and heartbeats to clear before binding')
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "pixiv_metadata_inventory_state" WHERE "id" = $1 FOR UPDATE',
        'pixiv'
      )
      const before = await inspectPixivRoot(transaction, input.scanRoot)
      if (before.fingerprint !== input.expected) throw conflict('Root inspection is stale; run inspect again')
      if (!before.state) throw conflict('No inventory exists; a new library is initialized by its first scan')
      if (before.state.rootPathHash !== createHash('sha256').update(before.root.absolutePath).digest('hex')) {
        throw conflict('Configured root path differs from inventory; path migration is not supported')
      }
      if (before.marker.status === 'INVALID')
        throw conflict('Invalid root marker must be investigated; it will not be overwritten')
      if (input.command === 'restore-marker') {
        if (!before.state.rootIdentity || before.marker.status !== 'MISSING') {
          throw conflict('restore-marker requires a bound inventory and a missing marker')
        }
        const identity = await createPixivRootMarker(before.root, before.state.rootIdentity)
        if (identity !== before.state.rootIdentity) throw conflict('Another marker appeared; inspect again')
      } else if (before.state.rootIdentity) {
        throw conflict('Inventory already has a UUID; bind cannot replace it')
      }
      const result = await bindPixivInventoryRoot(transaction, before.root, now, true)
      await assertPixivRootUnchanged({ ...before.root, rootIdentity: result.state.rootIdentity! })
      return { command: input.command, before, after: result.state }
    },
    { timeout: 30_000 }
  )
}

export async function runPixivRootIdentity(args: string[], environment = process.env): Promise<number> {
  const command = args[0]
  if (!['inspect', 'bind', 'restore-marker'].includes(command ?? ''))
    throw conflict('Usage: pixiv-root-identity inspect | bind | restore-marker')
  const scanRoot = environment.SCAN_PATH
  if (!scanRoot) throw conflict('SCAN_PATH is required')
  let expected = ''
  let confirmSameLibrary = false
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--expect' && !expected && args[i + 1]) expected = args[++i]!
    else if (args[i] === '--confirm-same-library' && !confirmSameLibrary) confirmSameLibrary = true
    else throw conflict('Unknown or duplicate command argument')
  }
  if (command === 'inspect' && args.length !== 1) throw conflict('inspect does not accept write options')
  const database = createDatabaseClient()
  try {
    const result =
      command === 'inspect'
        ? await inspectPixivRoot(database, scanRoot)
        : await maintainPixivRoot({
            database,
            scanRoot,
            command: command as Exclude<Command, 'inspect'>,
            expected,
            confirmSameLibrary
          })
    process.stdout.write(`${serialize(result)}\n`)
    return 0
  } finally {
    await database.$disconnect()
  }
}

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

function conflict(message: string) {
  return new ScanExecutorError('STATE_CONFLICT', message)
}

if (require.main === module) {
  void runPixivRootIdentity(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof ScanExecutorError ? error.message : 'Root identity operation failed; check database availability and migration status'}\n`
      )
      process.exitCode = 1
    })
}
