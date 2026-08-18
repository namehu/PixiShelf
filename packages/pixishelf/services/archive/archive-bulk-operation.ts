import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { redactArchiveText } from './archive-redaction'
import { ArchiveError } from './errors'

const BULK_IDEMPOTENCY_LOCK_NAMESPACE = 20_260_818
const BULK_TARGET_LOCK_NAMESPACE = 20_260_819

export type ArchiveBulkCommand = 'ENQUEUE' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY'
export type ArchiveBulkTarget = 'INTAKE_ITEM' | 'ARCHIVE_IMPORT'
export type ArchiveBulkResult = 'CREATED' | 'APPLIED' | 'REUSED' | 'SKIPPED' | 'CONFLICT' | 'FAILED'

export interface ArchiveBulkTargetResult {
  result: ArchiveBulkResult
  relatedId?: string | null
  code?: string | null
  message?: string | null
}

interface StartBulkOperationInput {
  idempotencyKey: string
  requestedByUserId: string
  commandType: ArchiveBulkCommand
  targetType: ArchiveBulkTarget
  targetIds: readonly string[]
  requestOptions?: unknown
}

export interface ArchiveBulkOperationDependencies {
  database?: PrismaClient
  now?: () => Date
}

export function archiveRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

// 两层 advisory lock：幂等键锁只串行化 operation 头的创建/校验；稳定目标锁则跨 operation 串行化同一目标的领域变更。
export async function runArchiveBulkOperation(
  input: StartBulkOperationInput,
  processTarget: (transaction: Prisma.TransactionClient, targetId: string) => Promise<ArchiveBulkTargetResult>,
  dependencies: ArchiveBulkOperationDependencies = {},
  recoverTargetError?: (
    transaction: Prisma.TransactionClient,
    targetId: string,
    error: unknown
  ) => Promise<ArchiveBulkTargetResult | null>
) {
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  const targetIds = [...new Set(input.targetIds)]
  // targetIds 在此排序以消除选择顺序差异；requestOptions 若含数组，调用方须先按其领域键稳定排序。
  const requestHash = archiveRequestFingerprint({
    commandType: input.commandType,
    targetType: input.targetType,
    targetIds: [...targetIds].sort(),
    requestOptions: input.requestOptions ?? null
  })
  const operation = await database.$transaction(async (transaction) => {
    await lockKey(transaction, BULK_IDEMPOTENCY_LOCK_NAMESPACE, input.idempotencyKey)
    const existing = await transaction.archiveBulkOperation.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    })
    if (existing) {
      if (
        existing.requestHash !== requestHash ||
        existing.commandType !== input.commandType ||
        existing.requestedCount !== targetIds.length ||
        existing.requestedByUserId !== input.requestedByUserId
      ) {
        throw new ArchiveError('STATE_CONFLICT', '该幂等键已绑定到不同的批量归档命令')
      }
      return existing
    }
    return transaction.archiveBulkOperation.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        requestHash,
        requestedByUserId: input.requestedByUserId,
        commandType: input.commandType,
        requestedCount: targetIds.length
      }
    })
  })

  // 每个 target 独立事务处理，任何单目标失败只影响该项的批次条目，不会回滚其他目标。
  for (const targetId of targetIds) {
    try {
      await database.$transaction(async (transaction) => {
        await lockKey(transaction, BULK_TARGET_LOCK_NAMESPACE, `${input.targetType}:${targetId}`)
        const existing = await transaction.archiveBulkOperationItem.findUnique({
          where: {
            operationId_targetType_targetId: {
              operationId: operation.id,
              targetType: input.targetType,
              targetId
            }
          }
        })
        if (existing) return

        const result = await processTarget(transaction, targetId)
        await transaction.archiveBulkOperationItem.create({
          data: {
            operationId: operation.id,
            targetType: input.targetType,
            targetId,
            result: result.result,
            relatedId: result.relatedId ?? null,
            code: result.code ?? null,
            message: redactArchiveText(result.message ?? null)
          }
        })
      })
    } catch (error) {
      await recordFailedTarget({
        database,
        operationId: operation.id,
        targetType: input.targetType,
        targetId,
        error,
        recoverTargetError
      })
    }
  }

  await finalizeOperation(database, operation.id, dependencies.now?.() ?? new Date())
  return getArchiveBulkOperation(operation.id, database)
}

export async function getArchiveBulkOperation(
  operationId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const operation = await database.archiveBulkOperation.findUnique({
    where: { id: operationId },
    include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
  })
  if (!operation) return null
  return {
    id: operation.id,
    commandType: operation.commandType,
    requestedCount: operation.requestedCount,
    counts: {
      created: operation.createdCount,
      applied: operation.appliedCount,
      reused: operation.reusedCount,
      skipped: operation.skippedCount,
      conflict: operation.conflictCount,
      failed: operation.failedCount
    },
    createdAt: operation.createdAt,
    completedAt: operation.completedAt,
    items: operation.items.map((item) => ({
      id: item.id,
      targetType: item.targetType,
      targetId: item.targetId,
      result: item.result,
      relatedId: item.relatedId,
      code: item.code,
      message: redactArchiveText(item.message),
      createdAt: item.createdAt
    }))
  }
}

async function recordFailedTarget(input: {
  database: PrismaClient
  operationId: string
  targetType: ArchiveBulkTarget
  targetId: string
  error: unknown
  recoverTargetError?: (
    transaction: Prisma.TransactionClient,
    targetId: string,
    error: unknown
  ) => Promise<ArchiveBulkTargetResult | null>
}) {
  const { database, operationId, targetType, targetId, error, recoverTargetError } = input
  // 目标失败归档同样需要目标锁，确保在 P2002 等重试场景下只留下一个审计结果条目，保持幂等性。
  await database.$transaction(async (transaction) => {
    await lockKey(transaction, BULK_TARGET_LOCK_NAMESPACE, `${targetType}:${targetId}`)
    const existing = await transaction.archiveBulkOperationItem.findUnique({
      where: { operationId_targetType_targetId: { operationId, targetType, targetId } }
    })
    if (existing) return
    const recovered = await recoverTargetError?.(transaction, targetId, error)
    const known = error instanceof ArchiveError
    await transaction.archiveBulkOperationItem.create({
      data: {
        operationId,
        targetType,
        targetId,
        result: recovered?.result ?? (known && error.code === 'STATE_CONFLICT' ? 'CONFLICT' : 'FAILED'),
        relatedId: recovered?.relatedId ?? null,
        code: recovered?.code ?? (known ? error.code : 'INTERNAL'),
        message: redactArchiveText(
          recovered?.message ?? (error instanceof Error ? error.message : '批量归档目标处理失败')
        )
      }
    })
  })
}

async function finalizeOperation(database: PrismaClient, operationId: string, completedAt: Date) {
  // 同一 operation 的 finalize 串行重算持久结果；只有逐项数达到 requestedCount 才标记完成，保留崩溃后续跑入口。
  await database.$transaction(async (transaction) => {
    await lockKey(transaction, BULK_TARGET_LOCK_NAMESPACE, `${operationId}:finalize`)
    const operation = await transaction.archiveBulkOperation.findUnique({ where: { id: operationId } })
    if (!operation) throw new ArchiveError('INTERNAL', '批量归档操作不存在')
    const groups = await transaction.archiveBulkOperationItem.groupBy({
      by: ['result'],
      where: { operationId },
      _count: { _all: true }
    })
    const counts = new Map(groups.map((group) => [group.result, group._count._all]))
    const processedCount = groups.reduce((total, group) => total + group._count._all, 0)
    await transaction.archiveBulkOperation.update({
      where: { id: operationId },
      data: {
        createdCount: counts.get('CREATED') ?? 0,
        appliedCount: counts.get('APPLIED') ?? 0,
        reusedCount: counts.get('REUSED') ?? 0,
        skippedCount: counts.get('SKIPPED') ?? 0,
        conflictCount: counts.get('CONFLICT') ?? 0,
        failedCount: counts.get('FAILED') ?? 0,
        completedAt: processedCount === operation.requestedCount ? (operation.completedAt ?? completedAt) : null
      }
    })
  })
}

async function lockKey(transaction: Prisma.TransactionClient, namespace: number, value: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${namespace}::integer, hashtext(${value}::text))::text AS "lock"`
  )
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}
