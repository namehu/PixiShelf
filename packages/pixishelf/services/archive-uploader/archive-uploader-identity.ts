import { z } from 'zod'
import { archiveUploaderNameSchema, normalizeArchiveUploaderName } from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import {
  createDefaultArchiveMediaProviderRegistry,
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor,
  type ArchiveUploaderProviderRegistry
} from '@pixishelf/job-executors'
import { prisma } from '@/lib/prisma'

export const resolveArchiveUploaderIdentitySchema = z.object({ name: archiveUploaderNameSchema }).strict()
export const UPLOADER_RESOLUTION_TIMEOUT_MS = 20_000

export type UploaderIdentityResolution =
  | {
      outcome: 'MATCHED'
      uploaderUid: string
      uploaderName: string
      evidenceExternalId: string
      existingSource: { id: string; displayName: string; status: 'ACTIVE' | 'ARCHIVED' } | null
    }
  | {
      outcome: 'UNRESOLVED'
      reason: 'NOT_FOUND' | 'TIMEOUT' | 'RATE_LIMITED' | 'UNAVAILABLE'
      message: string
    }

const inFlight = new WeakMap<PrismaClient, Map<string, Promise<UploaderIdentityResolution>>>()

export async function resolveArchiveUploaderIdentity(
  input: z.input<typeof resolveArchiveUploaderIdentitySchema>,
  dependencies: { database?: PrismaClient; uploaderProviders?: ArchiveUploaderProviderRegistry } = {}
): Promise<UploaderIdentityResolution> {
  const { name } = resolveArchiveUploaderIdentitySchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  let requests = inFlight.get(database)
  if (!requests) {
    requests = new Map()
    inFlight.set(database, requests)
  }
  const key = normalizeArchiveUploaderName(name)
  const existing = requests.get(key)
  if (existing) return existing

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<UploaderIdentityResolution>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException('Uploader lookup timed out', 'TimeoutError'))
      resolve({ outcome: 'UNRESOLVED', reason: 'TIMEOUT', message: '识别超时，保存后按名称搜索。' })
    }, UPLOADER_RESOLUTION_TIMEOUT_MS)
  })
  const operation = async (): Promise<UploaderIdentityResolution> => {
    try {
      const providers =
        dependencies.uploaderProviders ??
        new GovernedArchiveProviderRegistry(
          createDefaultArchiveMediaProviderRegistry(),
          new PostgresArchiveProviderGovernor(database)
        )
      const result = await providers.getUploaderScanner('e-hentai').scanUploader(
        {
          identityKind: 'NAME',
          identityValue: name,
          cursor: null,
          stopAtExternalId: null,
          limit: 1
        },
        { signal: controller.signal }
      )
      controller.signal.throwIfAborted()
      const item = result.items[0]
      if (!result.discoveredUploaderUid || !item?.uploaderName) {
        return { outcome: 'UNRESOLVED', reason: 'NOT_FOUND', message: '暂未找到可核验的账号，保存后按名称搜索。' }
      }
      const existingSource = await database.archiveUploaderSource.findFirst({
        where: { providerKey: 'e-hentai', sourceKind: 'UPLOADER', uploaderUid: result.discoveredUploaderUid },
        select: { id: true, displayName: true, status: true }
      })
      controller.signal.throwIfAborted()
      return {
        outcome: 'MATCHED',
        uploaderUid: result.discoveredUploaderUid,
        uploaderName: item.uploaderName,
        evidenceExternalId: item.externalId,
        existingSource
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return { outcome: 'UNRESOLVED', reason: 'TIMEOUT', message: '识别超时，保存后按名称搜索。' }
      }
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      return code === 'REMOTE_RATE_LIMITED'
        ? { outcome: 'UNRESOLVED', reason: 'RATE_LIMITED', message: '原站正在限流，可稍后重试；保存后按名称搜索。' }
        : { outcome: 'UNRESOLVED', reason: 'UNAVAILABLE', message: '暂时无法核验上传者，保存后按名称搜索。' }
    }
  }
  // The deadline aborts actual provider I/O; late DNS/permit cleanup cannot publish a result.
  const request = Promise.race([operation(), timeout]).finally(() => {
    clearTimeout(timer)
    requests.delete(key)
  })
  requests.set(key, request)
  return request
}
