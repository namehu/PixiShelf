import type { DedupPrepareContext } from './maintenance-prepare.ts'
import {
  ArtworkDedupOperationError,
  assertArtworkDedupDirectDeleteExecution,
  recordArtworkDedupFreshEvidence,
  type Prisma
} from '@pixishelf/db'
import type { DedupRoots } from './reader-protocol.ts'
import type { MaintenanceFileState } from './maintenance-files.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { throwIfAborted } from '../scan/bounded.ts'
type File = Prisma.ArtworkDedupOperationFileGetPayload<Record<string, never>>
export function rootFor(file: File, roots: DedupRoots) {
  const root = [roots.source, roots.archive].find(
    (r) => r.logicalRoot === file.logicalRoot && r.rootIdentity === file.rootIdentity
  )
  if (!root) throw new ArtworkDedupOperationError('ROOT_CHANGED')
  return root
}
export function state(file: File): MaintenanceFileState {
  if (
    file.size === null ||
    file.mtimeNs === null ||
    file.ctimeNs === null ||
    file.deviceId === null ||
    file.inode === null ||
    file.linkCount !== 1n ||
    !file.sha256
  ) {
    throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
  }
  return {
    size: file.size,
    mtimeNs: file.mtimeNs,
    ctimeNs: file.ctimeNs,
    deviceId: file.deviceId,
    inode: file.inode,
    linkCount: file.linkCount
  }
}
/** Repeat the bounded exclusive-directory inventory: new attachments cannot join an old confirmation. */
export async function verifyDirectory(
  context: DedupPrepareContext,
  item: Prisma.ArtworkDedupOperationArtworkGetPayload<Record<string, never>>,
  knownFiles?: Array<{ canonicalPath: string; status: string }>
) {
  const { transaction: tx, execution, reader, roots, signal } = context
  let directory: string | null = null
  let root = roots.source
  if (item.isUrl) {
    const manifest = await tx((t) =>
      t.artworkDedupOperationFile.findFirst({
        where: {
          operationId: execution.operationId,
          artworkId: item.artworkId,
          role: 'SOURCE_FILE',
          revisionId: { not: null }
        }
      })
    )
    if (!manifest) throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
    root = rootFor(manifest, roots)
    directory = manifest.relativeDirectory
  } else if (['LOCAL_CREATED', 'LOCAL_IMPORT'].includes(item.sourceLabel) && item.storagePath && item.storageKey) {
    directory = item.storagePath.replace(/^\/+|\/+$/g, '')
  }
  if (!directory) return
  const known = knownFiles ?? []
  if (!knownFiles) {
    let after: string | undefined
    for (;;) {
      const page = await tx(async t => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        return t.artworkDedupOperationFile.findMany({ where: { operationId: execution.operationId, artworkId: item.artworkId,
          rootIdentity: root.rootIdentity, ...(after ? { fileId: { gt: after } } : {}) },
          select: { fileId: true, canonicalPath: true, status: true }, orderBy: { fileId: 'asc' }, take: 500 })
      })
      known.push(...page)
      if (page.length < 500) break
      after = page.at(-1)!.fileId
    }
  }
  const byPath = new Map(known.map(file => [file.canonicalPath, file]))
  const descendants = new Set<string>()
  for (const file of known) {
    const pieces = file.canonicalPath.split('/')
    for (let length = 1; length < pieces.length; length++) descendants.add(pieces.slice(0, length).join('/'))
  }
  const stack = [{ path: directory, after: null as string | null, state: null as MaintenanceFileState | null }]
  let visited = 0
  while (stack.length) {
    const frame = stack.at(-1)!
    await tx(t => assertArtworkDedupDirectDeleteExecution(t, execution))
    const page = await reader.inspectDirectory({
      root,
      relativePath: frame.path,
      afterName: frame.after,
      expectedState: frame.state,
      signal
    })
    frame.state = page.state
    let descended = false
    for (const child of page.entries) {
      if (++visited > 10000 || stack.length > 12) throw new ArtworkDedupOperationError('DIRECTORY_BUDGET_EXCEEDED')
      const childPath = `${frame.path}/${child.name}`
      frame.after = child.name
      if (child.kind === 'FILE' && byPath.has(childPath)) {
        if (byPath.get(childPath)!.status === 'DELETED') throw new ArtworkDedupOperationError('FILE_CHANGED')
        continue
      }
      if (child.kind === 'DIRECTORY' && descendants.has(childPath)) {
        stack.push({ path: childPath, after: null, state: null })
        descended = true
        break
      }
      throw new ArtworkDedupOperationError('UNREVIEWED_ATTACHMENT')
    }
    if (!descended && page.nextName === null) stack.pop()
  }
}

export async function freshScope(context: DedupPrepareContext) {
  const { transaction: tx, execution, reader, roots, signal, shouldYield } = context
  const initial = await tx((t) => assertArtworkDedupDirectDeleteExecution(t, execution))
  let afterArtworkId = initial.afterArtworkId
  let resumeFileId = initial.afterFileId ?? undefined
  for (;;) {
    const item = await tx(async (t) => {
      await assertArtworkDedupDirectDeleteExecution(t, execution)
      return t.artworkDedupOperationArtwork.findFirst({
        where: { operationId: execution.operationId, artworkId: { gt: afterArtworkId } },
        orderBy: { artworkId: 'asc' }
      })
    })
    if (!item) return true
    let afterFileId = resumeFileId
    resumeFileId = undefined
    for (;;) {
      const files = await tx(async (t) => {
        await assertArtworkDedupDirectDeleteExecution(t, execution)
        return t.artworkDedupOperationFile.findMany({
          where: {
            operationId: execution.operationId,
            artworkId: item.artworkId,
            ...(afterFileId ? { fileId: { gt: afterFileId } } : {})
          },
          orderBy: { fileId: 'asc' },
          take: 100
        })
      })
      if (!files.length) break
      for (const file of files) {
        await (async () => {
          throwIfAborted(signal)
          const expected = state(file),
            root = rootFor(file, roots)

          if (file.status === 'DELETED') {
            if (
              item.role !== 'COPY' ||
              !(await tx((t) =>
                t.artworkDedupFileReceipt.findFirst({
                  where: {
                    operationId: execution.operationId,
                    fileId: file.fileId,
                    step: 'DELETE',
                    status: 'COMPLETED'
                  }
                })
              ))
            ) {
              throw new ArtworkDedupOperationError('INVALID_RECEIPT')
            }
            // Deleted files cannot be read; a new occupant must still never be removed or silently accepted.
            const observed = await reader.inspectMaintenance({ root, relativePath: file.canonicalPath, signal })
            if (observed.kind !== 'MISSING') throw new ArtworkDedupOperationError('FILE_CHANGED')
            return
          }
          const observed = await reader.inspectMaintenance({ root, relativePath: file.canonicalPath, signal })
          if (observed.kind === 'MISSING' && item.role === 'COPY' && file.status === 'DELETE_INTENT') {
            if (
              !(await tx((t) =>
                t.artworkDedupFileReceipt.findFirst({
                  where: { operationId: execution.operationId, fileId: file.fileId, step: 'DELETE', status: 'INTENT' }
                })
              ))
            ) {
              throw new ArtworkDedupOperationError('INVALID_RECEIPT')
            }
            return
          }
          if (
            observed.kind !== 'FILE' ||
            !observed.state ||
            observed.state.linkCount !== 1n ||
            !sameContentFileState(expected, observed.state)
          ) {
            throw new ArtworkDedupOperationError('FILE_CHANGED')
          }
          const read = await reader.read({ root, relativePath: file.canonicalPath, signal })
          if (read.sha256 !== file.sha256 || !sameContentFileState(expected, read.state)) {
            throw new ArtworkDedupOperationError('CONTENT_CHANGED')
          }
        })()
        await tx(async (t) => {
          await assertArtworkDedupDirectDeleteExecution(t, execution)
          await t.artworkDedupOperation.update({
            where: { id: execution.operationId },
            data: { afterFileId: file.fileId }
          })
        })
        if (shouldYield()) return false
      }
      afterFileId = files.at(-1)!.fileId
    }
    await verifyDirectory(context, item)
    const mediaCount = BigInt(
      await tx((t) =>
        t.artworkDedupOperationFile.count({
          where: { operationId: execution.operationId, artworkId: item.artworkId, role: 'MEDIA' }
        })
      )
    )
    if (mediaCount !== item.memberCount) throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
    await tx(async (t) => {
      await recordArtworkDedupFreshEvidence(t, {
        execution,
        artworkId: item.artworkId,
        contentSha256: item.contentSha256,
        membersSignature: item.membersSignature
      })
      await t.artworkDedupOperation.update({
        where: { id: execution.operationId },
        data: { afterArtworkId: item.artworkId, afterFileId: null }
      })
    })
    afterArtworkId = item.artworkId
  }
}
