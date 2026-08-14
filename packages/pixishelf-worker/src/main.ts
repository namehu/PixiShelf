import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { assertBackgroundQueueSchema, createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import {
  PrismaWorkerPresenceStore,
  WorkerHealthState,
  WorkerHost,
  type WorkerPresenceDatabaseClient
} from '@pixishelf/job-runtime'
import { createDefaultWorkerId, parseWorkerConfig } from './config.js'
import { createWorkerHealthServer } from './health-server.js'
import { createJsonLogger } from './logger.js'
import { defaultPreflightDependencies, runStartupPreflight } from './preflight.js'
import { registerShutdownSignals } from './shutdown-signals.js'
import { WorkerApplication } from './worker-application.js'

export async function runWorkerMain(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseWorkerConfig(environment)
  const logger = createJsonLogger()
  const database = createDatabaseClient({ datasourceUrl: config.databaseUrl })
  const healthState = new WorkerHealthState()
  const workerId = config.workerId ?? createDefaultWorkerId(hostname(), process.pid, randomUUID())
  const presenceStore = new PrismaWorkerPresenceStore(database as unknown as WorkerPresenceDatabaseClient)
  const host = new WorkerHost({
    identity: {
      workerId,
      serviceVersion: config.serviceVersion,
      hostname: hostname(),
      processId: process.pid,
      capabilities: []
    },
    presenceStore,
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
  const application = new WorkerApplication({
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
    disconnectDatabase: () => disconnectDatabase(database)
  })

  let resolveStopped: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
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
