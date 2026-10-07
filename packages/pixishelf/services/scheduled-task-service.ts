import { prisma } from '@/lib/prisma'
import { enqueueSingletonManualJob } from '@/services/background-task/manual-job-singleton'
import {
  CENTRAL_SCHEDULE_TIMEZONE,
  getCurrentOrNextShanghaiScheduleWindow
} from '@/services/background-task/schedule-window'
import { buildScheduledTaskJobDefinition } from '@/services/background-task/scheduled-task-payload'
import { getScheduledTaskDefinition, SCHEDULED_TASK_DEFINITIONS } from '@/services/scheduled-task-registry'
import type { VideoChapterPreviewGenerationMode } from '@/services/video-chapter-preview-service'
import { Prisma, ScheduleMode } from '@prisma/client'
import 'server-only'
export interface ScheduledTaskView {
  id: string
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
  scheduleMode: ScheduleMode
  timezone: string
  priority: number
  lastMaterializedAt: Date | null
  lastMaterializedDate: string | null
  lastJobId: string | null
  lastJobStatus: string | null
  lastJobMode: 'FORMAL' | 'PREVIEW' | null
  lastJobResult: ScheduledTaskLastJobResult | null
  nextRunAt: string | null
  executionWindow?: {
    timezone: typeof CENTRAL_SCHEDULE_TIMEZONE
    startAt: string
    endAt: string
  }
  config: unknown
}
export interface ScheduledTaskLastJobResult {
  deletedBulkOperations?: number
  deletedIntakeItems?: number
  deletedSubmissions?: number
  deletedPreviewSessions?: number
  deletedLogs?: number
  deletedRuns?: number
  progressCandidates?: number
  lifecycleCandidates?: number
  deletedProgressEvents?: number
  deletedLifecycleEvents?: number
  selected?: number
  deleted?: number
  missing?: number
  referenced?: number
  failed?: number
  reconciliationScanned?: number
  untrackedCandidates?: number
}
export async function ensureDefaultScheduledTasks() {
  const existingTasks = await prisma.scheduledTask.findMany({
    where: { key: { in: SCHEDULED_TASK_DEFINITIONS.map(({ key }) => key) } },
    select: { key: true, type: true, scheduleMode: true, timezone: true, mutexKey: true }
  })
  const existingByKey = new Map(existingTasks.map((task) => [task.key, task]))
  // Registry-owned fields are repaired only when missing or changed. This keeps
  // every task-list refresh from turning into a burst of otherwise identical upserts.
  for (const definition of SCHEDULED_TASK_DEFINITIONS) {
    const existing = existingByKey.get(definition.key)
    if (
      existing &&
      existing.type === definition.type &&
      existing.scheduleMode === ScheduleMode.DAILY &&
      existing.timezone === definition.defaultTimezone &&
      existing.mutexKey === definition.mutexKey
    ) {
      continue
    }
    await prisma.scheduledTask.upsert({
      where: { key: definition.key },
      update: {
        type: definition.type,
        scheduleMode: ScheduleMode.DAILY,
        timezone: definition.defaultTimezone,
        mutexKey: definition.mutexKey
      },
      create: {
        key: definition.key,
        type: definition.type,
        enabled: definition.defaultEnabled,
        scheduleMode: ScheduleMode.DAILY,
        time: definition.defaultTime,
        timezone: definition.defaultTimezone,
        priority: definition.defaultPriority,
        mutexKey: definition.mutexKey,
        ...(definition.defaultConfig !== undefined
          ? { config: JSON.parse(JSON.stringify(definition.defaultConfig)) as Prisma.InputJsonValue }
          : {})
      }
    })
  }
}
export async function listScheduledTasks(): Promise<ScheduledTaskView[]> {
  // 列表返回时注入最近状态与 nextRunAt 预估值，用于界面展示“上次计划入队/下次入队”而不强制触发执行。
  await ensureDefaultScheduledTasks()
  const tasks = await prisma.scheduledTask.findMany({
    orderBy: [{ priority: 'asc' }, { key: 'asc' }]
  })
  const lastJobIds = tasks.map((task) => task.lastJobId).filter((id): id is string => Boolean(id))
  const lastJobs = lastJobIds.length
    ? await prisma.systemJob.findMany({
        where: { id: { in: lastJobIds } },
        select: { id: true, status: true, payload: true, result: true }
      })
    : []
  const lastJobById = new Map(lastJobs.map((job) => [job.id, job]))
  const centralWindow = getCurrentOrNextShanghaiScheduleWindow(new Date())
  return tasks.map((task) => {
    const definition = getScheduledTaskDefinition(task.key)
    const lastJob = task.lastJobId ? lastJobById.get(task.lastJobId) : null
    return {
      id: task.id,
      key: task.key,
      type: task.type,
      name: definition?.name ?? task.key,
      description: definition?.description ?? '',
      enabled: task.enabled,
      scheduleMode: task.scheduleMode,
      timezone: CENTRAL_SCHEDULE_TIMEZONE,
      priority: task.priority,
      lastMaterializedAt: task.lastMaterializedAt,
      lastMaterializedDate: task.lastMaterializedDate,
      lastJobId: task.lastJobId,
      lastJobStatus: lastJob?.status ?? null,
      lastJobMode: lastJob ? getScheduledTaskJobMode(lastJob.payload) : null,
      lastJobResult: lastJob ? getScheduledTaskLastJobResult(lastJob.result) : null,
      nextRunAt: centralWindow ? `${centralWindow.scheduledForDate} 00:00 ${CENTRAL_SCHEDULE_TIMEZONE}` : null,
      ...(centralWindow
        ? {
            executionWindow: {
              timezone: CENTRAL_SCHEDULE_TIMEZONE,
              startAt: centralWindow.availableAt.toISOString(),
              endAt: centralWindow.deadlineAt.toISOString()
            }
          }
        : {}),
      config: task.config
    }
  })
}
function getScheduledTaskJobMode(payload: unknown): 'FORMAL' | 'PREVIEW' {
  return isRecord(payload) && payload.dryRun === true ? 'PREVIEW' : 'FORMAL'
}
function getScheduledTaskLastJobResult(result: unknown): ScheduledTaskLastJobResult | null {
  if (!isRecord(result)) return null
  const projected: ScheduledTaskLastJobResult = {}
  for (const key of [
    'deletedBulkOperations',
    'deletedIntakeItems',
    'deletedSubmissions',
    'deletedPreviewSessions',
    'deletedLogs',
    'deletedRuns',
    'progressCandidates',
    'lifecycleCandidates',
    'deletedProgressEvents',
    'deletedLifecycleEvents',
    'selected',
    'deleted',
    'missing',
    'referenced',
    'failed',
    'reconciliationScanned',
    'untrackedCandidates'
  ] as const) {
    const value = result[key]
    if (typeof value === 'number' && Number.isFinite(value)) projected[key] = value
  }
  return Object.keys(projected).length > 0 ? projected : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export async function updateScheduledTask(input: {
  key: string
  enabled?: boolean
  priority?: number
  config?: unknown
}) {
  await ensureDefaultScheduledTasks()
  const definition = getScheduledTaskDefinition(input.key)
  if (!definition) {
    throw new Error(`Unknown scheduled task: ${input.key}`)
  }
  const data: {
    enabled?: boolean
    priority?: number
    config?: Prisma.InputJsonValue
  } = {}
  if (input.enabled !== undefined) data.enabled = input.enabled
  if (input.priority !== undefined) data.priority = input.priority
  if (input.config !== undefined) data.config = JSON.parse(JSON.stringify(input.config)) as Prisma.InputJsonValue
  return prisma.scheduledTask.update({
    where: { key: input.key },
    data
  })
}
export async function triggerScheduledTaskNow(
  key: string,
  options: {
    chapterPreviewMode?: VideoChapterPreviewGenerationMode
    videoProbeMode?: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
    requestedByUserId?: string
  } = {}
) {
  await ensureDefaultScheduledTasks()
  const task = await prisma.scheduledTask.findUnique({ where: { key } })
  if (!task) {
    throw new Error(`Unknown scheduled task: ${key}`)
  }
  {
    if (!options.requestedByUserId) {
      throw new Error('requestedByUserId is required after central dispatcher cutover')
    }
    const definition = buildScheduledTaskJobDefinition(task.type, {
      trigger: 'manual',
      scheduleKey: task.key,
      taskConfig: task.config,
      chapterPreviewMode: options.chapterPreviewMode,
      videoProbeMode: options.videoProbeMode
    })
    const job = await enqueueSingletonManualJob(
      {
        type: definition.type,
        triggerSource: 'MANUAL',
        requestedByUserId: options.requestedByUserId,
        payload: definition.payload,
        priority: Math.min(99, Math.max(0, task.priority))
      },
      {
        afterEnqueue: async ({ transaction, job: enqueuedJob }) => {
          await transaction.scheduledTask.update({
            where: { key },
            data: { lastJobId: enqueuedJob.id }
          })
        }
      }
    )
    return { jobId: job.id }
  }
}
