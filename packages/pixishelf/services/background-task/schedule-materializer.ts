import { prisma } from '@/lib/prisma'
import { ensureDefaultScheduledTasks } from '@/services/scheduled-task-service'
import { Prisma } from '@pixishelf/db'
import { JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import 'server-only'
import { enqueueJob } from './job-command-service'
import {
  getShanghaiScheduleWindow,
  isShanghaiWeeklyReconciliationDate,
  type ShanghaiScheduleWindow
} from './schedule-window'
import { buildScheduledTaskJobDefinition } from './scheduled-task-payload'
const SCHEDULER_LOCK_NAMESPACE = 80432026
const SCHEDULER_LOCK_KEY = 8140
interface MaterializableScheduledTask {
  id: string
  key: string
  type: string
  priority: number
  config: unknown
}
interface MaterializerDatabaseClient {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
}
interface ScheduleMaterializerDependencies {
  database?: MaterializerDatabaseClient
  ensureDefaults?: typeof ensureDefaultScheduledTasks
}
export interface ScheduleMaterializationDecision {
  key: string
  type: string
  action: 'materialized' | 'existing' | 'skipped'
  jobId?: string
  reason?: 'invalid_definition' | 'not_scheduled_today'
}
export interface ScheduleMaterializerTickResult {
  now: string
  mode: 'CENTRAL'
  scheduledForDate: string
  windowState: 'OPEN' | 'CLOSED'
  requiresDispatcherExpiryCleanup: boolean
  decisions: ScheduleMaterializationDecision[]
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
  if (task.key === 'derived_media_gc_reconciliation' && !isShanghaiWeeklyReconciliationDate(window.scheduledForDate)) {
    return { key: task.key, type: task.type, action: 'skipped', reason: 'not_scheduled_today' }
  }
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
      scheduleKey: task.key,
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
