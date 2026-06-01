import 'server-only'

import { prisma } from '@/lib/prisma'
import * as JobService from '@/services/job-service'
import {
  getScheduledTaskDefinition,
  getScheduledTaskDefinitionByType,
  getScheduledTaskHandler,
  SCHEDULED_TASK_DEFINITIONS
} from '@/services/scheduled-task-registry'
import { ScheduleMode } from '@prisma/client'

export interface ScheduledTaskView {
  id: string
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
  scheduleMode: ScheduleMode
  time: string
  timezone: string
  priority: number
  mutexKey: string | null
  lastTriggeredAt: Date | null
  lastTriggeredDate: string | null
  lastJobId: string | null
  lastJobStatus: string | null
  nextRunAt: string | null
}

export interface SchedulerDecision {
  key: string
  type: string
  action: 'triggered' | 'skipped'
  reason?: string
  jobId?: string
}

export interface SchedulerTickResult {
  now: string
  decisions: SchedulerDecision[]
}

export async function ensureDefaultScheduledTasks() {
  for (const definition of SCHEDULED_TASK_DEFINITIONS) {
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
        enabled: false,
        scheduleMode: ScheduleMode.DAILY,
        time: definition.defaultTime,
        timezone: definition.defaultTimezone,
        priority: definition.defaultPriority,
        mutexKey: definition.mutexKey
      }
    })
  }
}

export async function listScheduledTasks(): Promise<ScheduledTaskView[]> {
  await ensureDefaultScheduledTasks()
  const tasks = await prisma.scheduledTask.findMany({
    orderBy: [{ priority: 'asc' }, { key: 'asc' }]
  })

  const lastJobIds = tasks.map((task) => task.lastJobId).filter((id): id is string => Boolean(id))
  const lastJobs = lastJobIds.length
    ? await prisma.systemJob.findMany({
        where: { id: { in: lastJobIds } },
        select: { id: true, status: true }
      })
    : []
  const statusByJobId = new Map(lastJobs.map((job) => [job.id, job.status]))

  return tasks.map((task) => {
    const definition = getScheduledTaskDefinition(task.key)
    return {
      id: task.id,
      key: task.key,
      type: task.type,
      name: definition?.name ?? task.key,
      description: definition?.description ?? '',
      enabled: task.enabled,
      scheduleMode: task.scheduleMode,
      time: task.time,
      timezone: task.timezone,
      priority: task.priority,
      mutexKey: task.mutexKey,
      lastTriggeredAt: task.lastTriggeredAt,
      lastTriggeredDate: task.lastTriggeredDate,
      lastJobId: task.lastJobId,
      lastJobStatus: task.lastJobId ? (statusByJobId.get(task.lastJobId) ?? null) : null,
      nextRunAt: getNextRunAt(task.time, task.timezone)
    }
  })
}

export async function updateScheduledTask(input: {
  key: string
  enabled?: boolean
  time?: string
  priority?: number
}) {
  await ensureDefaultScheduledTasks()
  const definition = getScheduledTaskDefinition(input.key)
  if (!definition) {
    throw new Error(`Unknown scheduled task: ${input.key}`)
  }

  const data: { enabled?: boolean; time?: string; priority?: number } = {}
  if (input.enabled !== undefined) data.enabled = input.enabled
  if (input.time !== undefined) data.time = normalizeDailyTime(input.time)
  if (input.priority !== undefined) data.priority = input.priority

  return prisma.scheduledTask.update({
    where: { key: input.key },
    data
  })
}

export async function triggerScheduledTaskNow(key: string) {
  await ensureDefaultScheduledTasks()
  const task = await prisma.scheduledTask.findUnique({ where: { key } })
  if (!task) {
    throw new Error(`Unknown scheduled task: ${key}`)
  }

  const handler = getScheduledTaskHandler(task.type)
  if (!handler) {
    throw new Error(`No handler registered for scheduled task type: ${task.type}`)
  }

  const result = await handler.start({ trigger: 'manual' })
  await prisma.scheduledTask.update({
    where: { key },
    data: {
      lastJobId: result.jobId
    }
  })

  return result
}

export async function runSchedulerTick(now = new Date()): Promise<SchedulerTickResult> {
  await ensureDefaultScheduledTasks()
  const tasks = await prisma.scheduledTask.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { key: 'asc' }]
  })

  const decisions: SchedulerDecision[] = []
  const activeMutexKeys = new Set<string>()

  const activeJobs = await JobService.getActiveJobsByTypes(Array.from(new Set(tasks.map((task) => task.type))))
  const activeTypes = new Set(activeJobs.map((job) => job.type))
  activeJobs.forEach((job) => {
    const definition = getScheduledTaskDefinitionByType(job.type)
    if (definition?.mutexKey) activeMutexKeys.add(definition.mutexKey)
  })

  for (const task of tasks) {
    const localNow = getLocalDateTime(now, task.timezone)
    const due = isDailyTaskDue({
      currentDate: localNow.date,
      currentTime: localNow.time,
      scheduledTime: task.time,
      lastTriggeredDate: task.lastTriggeredDate
    })

    if (!due.due) {
      decisions.push({ key: task.key, type: task.type, action: 'skipped', reason: due.reason })
      continue
    }

    if (activeTypes.has(task.type)) {
      decisions.push({ key: task.key, type: task.type, action: 'skipped', reason: 'already_running' })
      continue
    }

    if (task.mutexKey && activeMutexKeys.has(task.mutexKey)) {
      decisions.push({ key: task.key, type: task.type, action: 'skipped', reason: 'mutex_busy' })
      continue
    }

    const handler = getScheduledTaskHandler(task.type)
    if (!handler) {
      decisions.push({ key: task.key, type: task.type, action: 'skipped', reason: 'missing_handler' })
      continue
    }

    try {
      const result = await handler.start({ trigger: 'schedule' })
      await prisma.scheduledTask.update({
        where: { key: task.key },
        data: {
          lastTriggeredAt: now,
          lastTriggeredDate: localNow.date,
          lastJobId: result.jobId
        }
      })
      activeTypes.add(task.type)
      if (task.mutexKey) activeMutexKeys.add(task.mutexKey)
      decisions.push({ key: task.key, type: task.type, action: 'triggered', jobId: result.jobId })
    } catch (error) {
      decisions.push({
        key: task.key,
        type: task.type,
        action: 'skipped',
        reason: error instanceof Error ? error.message : 'trigger_failed'
      })
    }
  }

  return {
    now: now.toISOString(),
    decisions
  }
}

function normalizeDailyTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error('Time must be HH:mm')
  }
  const hour = Number(value.slice(0, 2))
  const minute = Number(value.slice(3, 5))
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Time must be HH:mm')
  }
  return value
}

function isDailyTaskDue(input: {
  currentDate: string
  currentTime: string
  scheduledTime: string
  lastTriggeredDate: string | null
}) {
  if (input.lastTriggeredDate === input.currentDate) {
    return { due: false, reason: 'already_triggered' }
  }

  if (input.currentTime < input.scheduledTime) {
    return { due: false, reason: 'not_due' }
  }

  return { due: true }
}

function getLocalDateTime(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  }
}

function getNextRunAt(time: string, timezone: string) {
  const now = new Date()
  const localNow = getLocalDateTime(now, timezone)
  return `${localNow.date} ${time} ${timezone}`
}
