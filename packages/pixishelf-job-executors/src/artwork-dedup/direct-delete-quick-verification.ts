import { z } from 'zod'
import {
  Prisma,
  ArtworkDedupOperationError,
  assertArtworkDedupDirectDeleteExecution,
  recordArtworkDedupFreshEvidence
} from '@pixishelf/db'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import { maintenanceSourceIdentitySchema } from './maintenance-source.ts'
import type { DedupPrepareContext } from './maintenance-prepare.ts'
import { rootFor, state, verifyDirectory } from './direct-delete-verification.ts'

type File = Prisma.ArtworkDedupOperationFileGetPayload<Record<string, never>>
const integer = z.string().regex(/^\d+$/).transform(BigInt)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const specSchema = z.discriminatedUnion('kind', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('MEDIA'),
      sha256: sha,
      state: z.object({ size: integer, mtimeNs: integer, ctimeNs: integer, deviceId: integer, inode: integer })
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('SOURCE'),
      expectedIdentity: maintenanceSourceIdentitySchema,
      seal: z
        .object({
          revisionId: z.string(),
          providerKey: z.string(),
          externalId: z.string(),
          sealedManifestSha256: sha.nullable(),
          manifestMediaSignature: sha.optional(),
          memberCount: integer
        })
        .optional()
    })
    .strict()
])
type Observed = {
  fileId: string
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  deviceId: bigint
  inode: bigint
  linkCount: bigint
  sha256: string
}
const changed = (code = 'FILE_CHANGED'): never => {
  throw new ArtworkDedupOperationError(code)
}

async function verifyFile(context: DedupPrepareContext, file: File): Promise<Observed> {
  const spec = specSchema.parse(file.verificationSpec),
    root = rootFor(file, context.roots)
  const request = { root, relativePath: file.canonicalPath, signal: context.signal }
  if (spec.kind === 'MEDIA') {
    if (file.role !== 'MEDIA') changed('SCOPE_MISMATCH')
    const observed = await context.reader.inspectMaintenance(request)
    if (
      observed.kind !== 'FILE' ||
      !observed.state ||
      observed.state.linkCount !== 1n ||
      observed.state.deviceId !== root.deviceId ||
      !sameContentFileState(spec.state, observed.state)
    )
      changed()
    const read = await context.reader.read(request)
    if (read.sha256 !== spec.sha256 || !sameContentFileState(spec.state, read.state)) changed('CONTENT_CHANGED')
    return { fileId: file.fileId, ...observed.state!, sha256: read.sha256 }
  }
  if (!['CHAPTER', 'SOURCE_FILE'].includes(file.role)) changed('SCOPE_MISMATCH')
  const observed = await context.reader.inspectSource({
    ...request,
    expectedIdentity: spec.expectedIdentity,
    offset: 0
  })
  if (!observed.state || observed.state.linkCount !== 1n || observed.state.deviceId !== root.deviceId) changed()
  if (spec.expectedIdentity.kind === 'ARCHIVE_MANIFEST') {
    const seal = spec.seal
    if (
      !seal ||
      seal.revisionId !== spec.expectedIdentity.revisionId ||
      seal.providerKey !== spec.expectedIdentity.providerKey ||
      seal.externalId !== spec.expectedIdentity.externalId ||
      seal.memberCount !== BigInt(observed.mediaCount) ||
      (seal.sealedManifestSha256
        ? seal.sealedManifestSha256 !== observed.sha256
        : seal.manifestMediaSignature !== observed.mediaSignature)
    )
      changed('ARCHIVE_MANIFEST_UNVERIFIED')
  }
  // Sidecars have semantic identity at consent time. Once read, retries must retain that physical identity too.
  if (file.sha256 && (file.sha256 !== observed.sha256 || !sameContentFileState(state(file), observed.state!)))
    changed('CONTENT_CHANGED')
  return { fileId: file.fileId, ...observed.state!, sha256: observed.sha256 }
}

/** Same-execution, normally yielded cursors commit with one bounded page of observed facts. Specs never change. */
export async function freshQuickScope(context: DedupPrepareContext) {
  const { transaction: tx, execution } = context
  const op = await tx((t) => assertArtworkDedupDirectDeleteExecution(t, execution))
  let afterArtworkId = op.afterArtworkId,
    afterFileId = op.afterFileId
  for (;;) {
    const item = await tx(async (t) => {
      await assertArtworkDedupDirectDeleteExecution(t, execution)
      return t.artworkDedupOperationArtwork.findFirst({
        where: { operationId: op.id, artworkId: { gt: afterArtworkId } },
        orderBy: { artworkId: 'asc' }
      })
    })
    if (!item) return true
    for (;;) {
      const files = await tx(async (t) => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        return t.artworkDedupOperationFile.findMany({
          where: {
            operationId: op.id,
            artworkId: item.artworkId,
            ...(afterFileId ? { fileId: { gt: afterFileId } } : {})
          },
          orderBy: { fileId: 'asc' },
          take: 100,
          include: { receipts: { where: { step: 'DELETE', status: { in: ['INTENT', 'COMPLETED'] } } } }
        })
      })
      if (!files.length) break
      const observations: Observed[] = []
      let checked = 0
      for (const file of files) {
        throwIfAborted(context.signal)
        if (file.status === 'DELETED' || file.status === 'DELETE_INTENT') {
          const observed = await context.reader.inspectMaintenance({
            root: rootFor(file, context.roots),
            relativePath: file.canonicalPath,
            signal: context.signal
          })
          if (observed.kind === 'MISSING') {
            if (
              item.role !== 'COPY' ||
              !file.receipts.some((r) => r.status === (file.status === 'DELETED' ? 'COMPLETED' : 'INTENT'))
            )
              changed('INVALID_RECEIPT')
          } else {
            if (file.status === 'DELETED') changed()
            observations.push(await verifyFile(context, file))
          }
        } else observations.push(await verifyFile(context, file))
        afterFileId = file.fileId
        checked++
        if (context.shouldYield()) break
      }
      await tx(async (t) => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        if (observations.length)
          await t.$executeRaw(Prisma.sql`
          UPDATE "ArtworkDedupOperationFile" f SET size=v.size,"mtimeNs"=v."mtimeNs","ctimeNs"=v."ctimeNs","deviceId"=v."deviceId",inode=v.inode,"linkCount"=v."linkCount",sha256=v.sha256,
            "fileType"='FILE',"inspectionStatus"='VERIFIED',status=CASE WHEN f.status='DELETE_INTENT' THEN f.status ELSE 'VERIFIED' END,"updatedAt"=CURRENT_TIMESTAMP
          FROM jsonb_to_recordset(${JSON.stringify(observations, (_, value) => (typeof value === 'bigint' ? value.toString() : value))}::jsonb)
            AS v("fileId" text,size bigint,"mtimeNs" bigint,"ctimeNs" bigint,"deviceId" bigint,inode bigint,"linkCount" bigint,sha256 text)
          WHERE f."operationId"=${op.id} AND f."fileId"=v."fileId"`)
        await t.artworkDedupOperation.update({
          where: { id: op.id },
          data: { afterFileId, verifiedFiles: { increment: checked } }
        })
      })
      if (context.shouldYield()) return false
    }
    await tx(async (t) => {
      await assertArtworkDedupDirectDeleteExecution(t, execution)
      if (
        BigInt(
          await t.artworkDedupOperationFile.count({
            where: { operationId: op.id, artworkId: item.artworkId, role: 'MEDIA' }
          })
        ) !== item.memberCount
      )
        changed('INCOMPLETE_EVIDENCE')
      await recordArtworkDedupFreshEvidence(t, {
        execution,
        artworkId: item.artworkId,
        contentSha256: item.contentSha256,
        membersSignature: item.membersSignature
      })
      await t.artworkDedupOperation.update({
        where: { id: op.id },
        data: { afterArtworkId: item.artworkId, afterFileId: null }
      })
    })
    afterArtworkId = item.artworkId
    afterFileId = null
  }
}

/** Before initial deletion and each safe continuation, retain keeper/file identity and exact directory membership without rehashing. */
export async function verifyQuickScopeState(context: DedupPrepareContext) {
  const { transaction: tx, execution } = context
  const op = await tx((t) => assertArtworkDedupDirectDeleteExecution(t, execution))
  let afterArtworkId = op.afterArtworkId,
    afterFileId = op.afterFileId
  for (;;) {
    const item = await tx(async (t) => {
      await assertArtworkDedupDirectDeleteExecution(t, execution)
      return t.artworkDedupOperationArtwork.findFirst({
        where: { operationId: op.id, artworkId: { gt: afterArtworkId } },
        orderBy: { artworkId: 'asc' }
      })
    })
    if (!item) return true
    for (;;) {
      const files = await tx(async (t) => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        return t.artworkDedupOperationFile.findMany({
          where: {
            operationId: op.id,
            artworkId: item.artworkId,
            ...(afterFileId ? { fileId: { gt: afterFileId } } : {})
          },
          orderBy: { fileId: 'asc' },
          take: 100
        })
      })
      if (!files.length) break
      for (const file of files) {
        throwIfAborted(context.signal)
        const observed = await context.reader.inspectMaintenance({
          root: rootFor(file, context.roots),
          relativePath: file.canonicalPath,
          signal: context.signal
        })
        if (
          !(observed.kind === 'MISSING' && item.role === 'COPY' && ['DELETED', 'DELETE_INTENT'].includes(file.status))
        ) {
          if (
            file.status === 'DELETED' ||
            observed.kind !== 'FILE' ||
            !observed.state ||
            observed.state.linkCount !== 1n ||
            !sameContentFileState(state(file), observed.state)
          )
            changed()
        }
        afterFileId = file.fileId
        if (context.shouldYield()) break
      }
      await tx(async (t) => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        await t.artworkDedupOperation.update({ where: { id: op.id }, data: { afterFileId } })
      })
      if (context.shouldYield()) return false
    }
    await verifyDirectory(context, item)
    await tx(async (t) => {
      await assertArtworkDedupDirectDeleteExecution(t, execution)
      await t.artworkDedupOperationArtwork.update({
        where: { operationId_artworkId: { operationId: op.id, artworkId: item.artworkId } },
        data: { inspectionComplete: true }
      })
      await t.artworkDedupOperation.update({
        where: { id: op.id },
        data: { afterArtworkId: item.artworkId, afterFileId: null }
      })
    })
    afterArtworkId = item.artworkId
    afterFileId = null
    if (context.shouldYield()) return false
  }
}
