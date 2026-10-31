import path from 'node:path'
import {
  lockCreatorCatalog,
  finishMediaContentSourceWrite,
  withMediaContentOwnerPublication,
  type Prisma,
  type PrismaClient,
  type MediaContentOwner,
  type MediaContentResult,
  type MediaContentWriteHandle,
  type MediaContentTransaction
} from '@pixishelf/db'
import { resolveMediaContentRoots, resolveMediaContentPath } from '../media-content/index.ts'
import type { ContentWriteAuthorization } from '@pixishelf/job-contracts'
import { resolveCreatablePathWithinRoot } from './safe-path.ts'
export type AppTransaction = Prisma.TransactionClient
export class ContentWriteConflict extends Error {
  readonly status = 409
  constructor(message = '媒体状态已变化或正在写入，请刷新后重试。') {
    super(message)
  }
}
export function requireContentReady<T>(result: MediaContentResult<T>): T {
  if (result.status !== 'READY') throw new ContentWriteConflict(`媒体暂不可操作（${result.status}）。`)
  return result.value
}
export const contentTx = (tx: AppTransaction) => tx as unknown as MediaContentTransaction
export const contentOwner = (userId: string, sessionId: string): MediaContentOwner => ({
  ownerUserId: userId,
  sessionId,
  sessionVersion: 1n,
  execution: null
})
export const contentHandle = (auth: ContentWriteAuthorization): MediaContentWriteHandle => ({
  ...auth.handle,
  declarationVersion: BigInt(auth.handle.declarationVersion)
})
export const contentAuthorization = (
  sessionId: string,
  handle: MediaContentWriteHandle
): ContentWriteAuthorization => ({
  sessionId,
  handle: { ...handle, declarationVersion: handle.declarationVersion.toString() }
})

export function createDeletionContentContext(prisma: PrismaClient, archiveRoot: string) {
  async function resolveContentPath(scanRoot: string, target: string) {
    const inventory = await prisma.pixivMetadataInventoryState.findUnique({
      where: { id: 'pixiv' },
      select: { rootIdentity: true }
    })
    const roots = await resolveMediaContentRoots({
      sourceRoot: scanRoot,
      archiveRoot: archiveRoot,
      expectedPixivRootIdentity: inventory?.rootIdentity ?? null
    })
    const configuredTarget = await resolveCreatablePathWithinRoot(scanRoot, target)
    const relativePath = path.relative(path.resolve(scanRoot), configuredTarget).split(path.sep).join('/')
    const { absolutePath } = await resolveMediaContentPath(roots.source, relativePath, {
      allowMissing: true,
      kind: 'file'
    })
    if (!relativePath || relativePath.startsWith('../')) throw new ContentWriteConflict('无效的媒体路径。')
    const relativeDirectory = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath)
    return {
      absolutePath,
      relativePath,
      directory: { logicalRoot: roots.source.logicalRoot, rootIdentity: roots.source.rootIdentity, relativeDirectory }
    }
  }

  async function finishContentSources(
    tx: AppTransaction,
    writeToken: string,
    outcome: 'committed' | 'verified-rollback'
  ) {
    const [artworks, images] = await Promise.all([
      tx.artworkContentSource.findMany({ where: { writeToken }, select: { artworkId: true } }),
      tx.mediaContentSource.findMany({ where: { writeToken }, select: { imageId: true } })
    ])
    for (let i = 0; i < Math.max(artworks.length, images.length); i += 100) {
      const ok = await finishMediaContentSourceWrite(contentTx(tx), {
        token: {
          writeToken,
          artworkIds: artworks.slice(i, i + 100).map((row) => row.artworkId),
          imageIds: images.slice(i, i + 100).map((row) => row.imageId)
        },
        outcome
      })
      if (!ok) throw new ContentWriteConflict()
    }
  }

  async function publishContentOwner<T>(
    tx: AppTransaction,
    userId: string,
    authorizations: ContentWriteAuthorization[],
    outcome: 'committed' | 'verified-rollback',
    publish: (tx: AppTransaction) => Promise<T>
  ) {
    if (!authorizations.length || authorizations.some((auth) => auth.sessionId !== authorizations[0]!.sessionId)) {
      throw new ContentWriteConflict()
    }
    await lockCreatorCatalog(contentTx(tx))
    const result = await withMediaContentOwnerPublication(
      contentTx(tx),
      {
        owner: contentOwner(userId, authorizations[0]!.sessionId),
        handles: authorizations.map(contentHandle),
        outcome,
        now: new Date()
      },
      async (inner) => {
        const value = await publish(inner as unknown as AppTransaction)
        for (const auth of authorizations) {
          await finishContentSources(inner as unknown as AppTransaction, auth.handle.writeToken, outcome)
        }
        return value
      }
    )
    return result.result
  }

  return { resolveContentPath, publishContentOwner }
}
