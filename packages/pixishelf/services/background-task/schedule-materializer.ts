import 'server-only'

import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ensureDefaultScheduledTasks, runSchedulerTick } from '@/services/scheduled-task-service'
import { JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { isCentralDispatcherCutoverEnabled } from './dispatcher-cutover'
import { enqueueJob } from './job-command-service'
import { getShanghaiScheduleWindow, type ShanghaiScheduleWindow } from './schedule-window'
import { buildScheduledTaskJobDefinition } from './scheduled-task-payload'

const SCHEDULER_LOCK_NAMESPACE = 80_432_026
const SCHEDULER_LOCK_KEY = 8_140

interface MaterializableScheduledTask {
  id: string
  key: string
  type: string
  priority: number
  config: unknown
}

interface LegacySchedulerResult {
  now: string
  decisions: Array<{ key: string; type: string; action: 'triggered' | 'skipped'; reason?: string; jobId?: string }>
}

interface MaterializerDatabaseClient {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
}

interface ScheduleMaterializerDependencies {
  database?: MaterializerDatabaseClient
  cutoverEnabled?: boolean
  ensureDefaults?: typeof ensureDefaultScheduledTasks
  runLegacyTick?: (now: Date) => Promise<LegacySchedulerResult>
}

export interface ScheduleMaterializationDecision {
  key: string
  type: string
  action: 'materialized' | 'existing' | 'skipped'
  jobId?: string
  reason?: 'invalid_definition'
}

export interface ScheduleMaterializerTickResult {
  now: string
  mode: 'CENTRAL' | 'LEGACY'
  scheduledForDate: string
  windowState: 'OPEN' | 'CLOSED' | 'LEGACY'
  requiresDispatcherExpiryCleanup: boolean
  decisions: Array<ScheduleMaterializationDecision | LegacySchedulerResult['decisions'][number]>
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function toScheduledQueuePriority(priority: number) {
  return priority < 100 ? 100 + clamp(priority, 0, 99) : clamp(priority, 100, 999)
}

export { getShanghaiScheduleWindow } from './schedule-window'

function reuseTransaction(transaction: Prisma.TransactionClient) {
  return {
    $transaction<T>(callback: (current: Prisma.TransactionClient) => Promise<T>) {
      return callback(transaction)
    }
  }
}

async function materializeTask(
  transaction: Prisma.TransactionClient,
  task: MaterializableScheduledTask,
  window: ShanghaiScheduleWindow,
  now: Date
): Promise<ScheduleMaterializationDecision> {
  const existing = await transaction.systemJob.findFirst({
    where: {
      scheduledTaskId: task.id,
      scheduledForDate: window.scheduledForDate
    },
    select: { id: true }
  })
  if (existing) {
    return { key: task.key, type: task.type, action: 'existing', jobId: existing.id }
  }

  let definition: ReturnType<typeof buildScheduledTaskJobDefinition>
  try {
    definition = buildScheduledTaskJobDefinition(task.type, {
      trigger: 'schedule',
      taskConfig: task.config
    })
  } catch {
    return { key: task.key, type: task.type, action: 'skipped', reason: 'invalid_definition' }
  }

  const job = await enqueueJob(
    {
      type: definition.type,
      definitionVersion: JOB_DEFINITION_VERSION,
      triggerSource: 'SCHEDULE',
      scheduledTaskId: task.id,
      scheduledForDate: window.scheduledForDate,
      idempotencyKey: `scheduled-task:${task.id}:${window.scheduledForDate}:v${JOB_DEFINITION_VERSION}`,
      payload: definition.payload,
      priority: toScheduledQueuePriority(task.priority),
      availableAt: window.availableAt,
      deadlineAt: window.deadlineAt
    },
    reuseTransaction(transaction),
    () => now
  )

  await transaction.scheduledTask.update({
    where: { id: task.id },
    data: {
      lastMaterializedAt: now,
      lastMaterializedDate: window.scheduledForDate,
      lastJobId: job.id
    }
  })

  return { key: task.key, type: task.type, action: 'materialized', jobId: job.id }
}

export async function runScheduleMaterializerTick(
  now = new Date(),
  dependencies: ScheduleMaterializerDependencies = {}
): Promise<ScheduleMaterializerTickResult> {
  const window = getShanghaiScheduleWindow(now)
  const cutoverEnabled = dependencies.cutoverEnabled ?? isCentralDispatcherCutoverEnabled()

  if (!cutoverEnabled) {
    logger.warn('scheduler.tick.legacy_dispatch_path', {
      centralDispatcherCutoverEnabled: false,
      warning: 'Legacy scheduled handlers may start detached in-process work until dispatcher cutover is enabled'
    })
    const legacy = await (dependencies.runLegacyTick ?? runSchedulerTick)(now)
    return {
      ...legacy,
      mode: 'LEGACY',
      scheduledForDate: window.scheduledForDate,
      windowState: 'LEGACY',
      requiresDispatcherExpiryCleanup: false
    }
  }

  if (!window.isOpen) {
    return {
      now: now.toISOString(),
      mode: 'CENTRAL',
      scheduledForDate: window.scheduledForDate,
      windowState: 'CLOSED',
      requiresDispatcherExpiryCleanup: true,
      decisions: []
    }
  }

  await (dependencies.ensureDefaults ?? ensureDefaultScheduledTasks)()
  const database = dependencies.database ?? (prisma as unknown as MaterializerDatabaseClient)
  const decisions = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${SCHEDULER_LOCK_NAMESPACE}::integer, ${SCHEDULER_LOCK_KEY}::integer)::text AS "lock"`
    )
    const tasks = await transaction.scheduledTask.findMany({
      where: { enabled: true, scheduleMode: 'DAILY' },
      orderBy: [{ priority: 'asc' }, { key: 'asc' }],
      select: { id: true, key: true, type: true, priority: true, config: true }
    })

    const materialized: ScheduleMaterializationDecision[] = []
    for (const task of tasks) {
      materialized.push(await materializeTask(transaction, task, window, now))
    }
    return materialized
  })

  return {
    now: now.toISOString(),
    mode: 'CENTRAL',
    scheduledForDate: window.scheduledForDate,
    windowState: 'OPEN',
    requiresDispatcherExpiryCleanup: false,
    decisions
  }
}
