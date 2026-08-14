import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { assertBackgroundQueueSchema, createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import {
  PrismaWorkerPresenceStore,
  PostgresQueueRepository,
  WorkerHealthState,
  WorkerHost,
  type QueueDatabase,
  type WorkerPresenceDatabaseClient
} from '@pixishelf/job-runtime'
import { createDefaultWorkerId, parseWorkerConfig } from './config.js'
import { createWorkerExecutorRegistry } from './create-worker-executor-registry.js'
import { CentralDispatcher } from './dispatcher.js'
import { createWorkerHealthServer } from './health-server.js'
import { createJsonLogger } from './logger.js'
import { PresenceReadinessGate } from './presence-readiness-gate.js'
import { defaultPreflightDependencies, runStartupPreflight } from './preflight.js'
import { registerShutdownSignals } from './shutdown-signals.js'
import { RuntimeDispatcherQueue } from './runtime-dispatcher-queue.js'
import { WorkerApplication } from './worker-application.js'

export async function runWorkerMain(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseWorkerConfig(environment)
  const logger = createJsonLogger()
  const database = createDatabaseClient({ datasourceUrl: config.databaseUrl })
  const registry = createWorkerExecutorRegistry({ database, config })
  const healthState = new WorkerHealthState()
  const workerId = config.workerId ?? createDefaultWorkerId(hostname(), process.pid, randomUUID())
  const presenceReadinessGate = new PresenceReadinessGate(
    new PrismaWorkerPresenceStore(database as unknown as WorkerPresenceDatabaseClient)
  )
  const host = new WorkerHost({
    identity: {
      workerId,
      serviceVersion: config.serviceVersion,
      hostname: hostname(),
      processId: process.pid,
      capabilities: registry.capabilities()
    },
    presenceStore: presenceReadinessGate,
    healthState,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    onHeartbeatError: (error) => logger.error('worker.heartbeat_failed', { workerId, error }),
    onHeartbeatRecovered: () => logger.info('worker.heartbeat_recovered', { workerId })
  })
  const healthServer = createWorkerHealthServer({
    state: healthState,
    host: config.healthHost,
    port: config.healthPort,
    logger
  })
  let resolveStopped: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  let application: WorkerApplication
  const dispatcher = config.dispatchEnabled
    ? new CentralDispatcher({
        enabled: true,
        workerId,
        queue: new RuntimeDispatcherQueue(
          new PostgresQueueRepository(database as unknown as QueueDatabase, {
            leaseDurationMs: config.jobLeaseDurationMs,
            transactionMaxWaitMs: config.queueTransactionMaxWaitMs,
            transactionTimeoutMs: config.queueTransactionTimeoutMs
          })
        ),
        registry,
        logger,
        pollIntervalMs: config.dispatchPollIntervalMs,
        heartbeatIntervalMs: config.jobHeartbeatIntervalMs,
        drainGraceMs: config.dispatchDrainGraceMs,
        onFatal: (error) => {
          process.exitCode = 1
          host.fail(error)
          void application.shutdown('dispatcher-fatal').finally(() => resolveStopped?.())
        }
      })
    : undefined
  application = new WorkerApplication({
    healthState,
    healthServer,
    host,
    logger,
    preflight: () =>
      runStartupPreflight(
        config,
        {
          ...defaultPreflightDependencies,
          checkDatabaseSchema: () => assertBackgroundQueueSchema(database)
        },
        host.signal
      ),
    disconnectDatabase: () => disconnectDatabase(database),
    presenceReadinessGate,
    ...(dispatcher ? { dispatcher } : {})
  })

  const requestShutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    void application.shutdown(signal).finally(() => resolveStopped?.())
  }
  const unregisterSignals = registerShutdownSignals(process, requestShutdown)

  try {
    await application.start()
    await stopped
  } finally {
    unregisterSignals()
    await application.shutdown('main-finally')
  }
}

if (require.main === module) {
  void runWorkerMain().catch((error) => {
    createJsonLogger(process.stderr).error('worker.fatal', { error })
    process.exitCode = 1
  })
}
