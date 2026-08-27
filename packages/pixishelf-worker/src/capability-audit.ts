import { createDatabaseClient } from '@pixishelf/db'
import {
  assertProductionWorkerCapabilities,
  canonicalWorkerCapabilities,
  PRODUCTION_WORKER_CAPABILITIES
} from './production-capabilities.js'

const DEFAULT_FRESHNESS_MS = 60_000

interface ReadyWorkerRecord {
  capabilities: unknown
}

export interface CapabilityAuditDatabase {
  workerInstance: {
    findMany(input: {
      where: { status: 'READY'; heartbeatAt: { gte: Date } }
      orderBy: { workerId: 'asc' }
      select: { capabilities: true }
      take: number
    }): Promise<ReadyWorkerRecord[]>
  }
}

class CapabilityAuditError extends Error {}

export async function auditProductionWorkerCapabilities(
  database: CapabilityAuditDatabase,
  options: { now?: Date; freshnessMs?: number } = {}
) {
  const now = options.now ?? new Date()
  const freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS
  let workers: ReadyWorkerRecord[]
  try {
    workers = await database.workerInstance.findMany({
      where: { status: 'READY', heartbeatAt: { gte: new Date(now.getTime() - freshnessMs) } },
      orderBy: { workerId: 'asc' },
      select: { capabilities: true },
      take: 2
    })
  } catch {
    throw new CapabilityAuditError('unable to query online Worker capability state')
  }

  if (workers.length !== 1) {
    throw new CapabilityAuditError(`expected exactly one online READY Worker, found ${workers.length}`)
  }
  const actual = parseCapabilities(workers[0]!.capabilities)
  try {
    assertProductionWorkerCapabilities(actual)
  } catch {
    throw new CapabilityAuditError(
      'online READY Worker capability inventory does not match the 24-job/26-version dual-lane release'
    )
  }
  const expected = canonicalWorkerCapabilities(PRODUCTION_WORKER_CAPABILITIES)
  return { readyWorkers: 1, capabilities: expected.length }
}

export async function runCapabilityAudit(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: {
    createClient?: (databaseUrl: string) => CapabilityAuditDatabase & { $disconnect(): Promise<void> }
    writeOutput?: (message: string) => void
    writeError?: (message: string) => void
  } = {}
) {
  const writeOutput = dependencies.writeOutput ?? ((message) => process.stdout.write(`${message}\n`))
  const writeError = dependencies.writeError ?? ((message) => process.stderr.write(`${message}\n`))
  let database: (CapabilityAuditDatabase & { $disconnect(): Promise<void> }) | undefined
  let result: { readyWorkers: number; capabilities: number } | undefined
  let failure: string | undefined
  try {
    const databaseUrl = requirePostgresUrl(environment.DATABASE_URL)
    database = dependencies.createClient?.(databaseUrl) ?? createDatabaseClient({ datasourceUrl: databaseUrl })
    result = await auditProductionWorkerCapabilities(database)
  } catch (error) {
    const message = error instanceof CapabilityAuditError ? error.message : 'invalid audit configuration'
    failure = message
  }
  if (database) {
    try {
      await database.$disconnect()
    } catch {
      failure ??= 'unable to close the database connection'
    }
  }
  if (failure || !result) {
    writeError(`Worker capability audit failed: ${failure ?? 'unexpected audit failure'}`)
    return 1
  }
  writeOutput(
    `Worker capability audit passed: ${result.readyWorkers} READY Worker, ${result.capabilities} job types / 26 versions (SCAN v1/v2/v3)`
  )
  return 0
}

function requirePostgresUrl(value: string | undefined): string {
  if (!value) throw new CapabilityAuditError('DATABASE_URL is required')
  try {
    const url = new URL(value)
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('unsupported protocol')
  } catch {
    throw new CapabilityAuditError('DATABASE_URL must be a valid PostgreSQL URL')
  }
  return value
}

function parseCapabilities(value: unknown) {
  if (!Array.isArray(value)) throw new CapabilityAuditError('online READY Worker reported invalid capabilities')
  return canonicalWorkerCapabilities(
    value.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.jobType !== 'string' ||
        typeof entry.executionLane !== 'string' ||
        !Array.isArray(entry.definitionVersions)
      ) {
        throw new CapabilityAuditError('online READY Worker reported invalid capabilities')
      }
      const fields = Object.keys(entry).sort()
      if (
        fields.length !== 3 ||
        fields[0] !== 'definitionVersions' ||
        fields[1] !== 'executionLane' ||
        fields[2] !== 'jobType'
      ) {
        throw new CapabilityAuditError('online READY Worker reported invalid capabilities')
      }
      if (!entry.definitionVersions.every((version) => Number.isSafeInteger(version) && version > 0)) {
        throw new CapabilityAuditError('online READY Worker reported invalid capabilities')
      }
      return {
        jobType: entry.jobType,
        executionLane: entry.executionLane,
        definitionVersions: entry.definitionVersions as number[]
      }
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

if (require.main === module) {
  void runCapabilityAudit()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch(() => {
      process.stderr.write('Worker capability audit failed: unexpected audit failure\n')
      process.exitCode = 1
    })
}
