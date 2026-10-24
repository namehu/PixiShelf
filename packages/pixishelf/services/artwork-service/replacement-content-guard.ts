import { writeRecoveryManifest } from './recovery-manifest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { resolveMediaContentChildWrites, getMediaContentWriteHandle } from '@pixishelf/db'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'
import { resolveCreatablePathWithinRoot } from '@/lib/safe-path'
import { prisma } from '@/lib/prisma'
import {
  assertContentOwner,
  contentHandle,
  contentOwner,
  contentReceipt,
  contentTx,
  ContentWriteConflict,
  requireContentReady,
  resolveContentPath,
  verifyUploadReceipt
} from './content-source-guard'

export async function verifyReplacementOwner(
  scanRoot: string,
  targetDir: string,
  userId: string,
  auth: ContentWriteAuthorization
) {
  const target = await resolveContentPath(scanRoot, path.join(targetDir, '.directory-identity'))
  await prisma.$transaction(async (tx) => {
    await assertContentOwner(tx, userId, auth)
    const directory = await tx.mediaContentDirectoryState.findUnique({ where: { id: auth.handle.directoryId } })
    if (
      auth.handle.scope.kind !== 'DIRECTORY' ||
      auth.handle.parentWriteId !== null ||
      !directory ||
      directory.logicalRoot !== target.directory.logicalRoot ||
      directory.relativeDirectory !== target.directory.relativeDirectory ||
      directory.rootIdentity !== target.directory.rootIdentity
    ) {
      throw new ContentWriteConflict()
    }
  })
}

export async function resolveReplacementChildren(input: {
  scanRoot: string
  userId: string
  parent: ContentWriteAuthorization
  publish: Array<{ path: string; size: number; uploadReceipt?: MediaUploadReceipt }>
  rollback?: boolean
}) {
  const selected = new Map(input.publish.map((file) => [file.uploadReceipt?.authorization.handle.writeId, file]))
  if (selected.has(undefined) || selected.size !== input.publish.length) {
    throw new ContentWriteConflict('替换文件缺少唯一上传回执。')
  }
  let cursor: string | undefined
  let selectedCount = 0
  for (;;) {
    const children = await prisma.mediaContentPathWrite.findMany({
      where: { parentWriteId: input.parent.handle.writeId },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    })
    if (!children.length) break
    for (const child of children) {
      const owner = contentOwner(input.userId, input.parent.sessionId)
      const handle = await prisma.$transaction(async (tx) =>
        requireContentReady(
          await getMediaContentWriteHandle(contentTx(tx), { owner, writeId: child.id, writeToken: child.writeToken })
        )
      )
      const file = selected.get(child.id)
      if (file && !input.rollback) {
        if (
          !file.uploadReceipt ||
          file.uploadReceipt.authorization.sessionId !== input.parent.sessionId ||
          handle.parentWriteId !== input.parent.handle.writeId
        ) {
          throw new ContentWriteConflict()
        }
        await prisma.$transaction(async (tx) => {
          await verifyUploadReceipt(tx, input.userId, file.uploadReceipt!, file.path, {
            size: file.size,
            resolvedChild: child.childDisposition === 'PUBLISH'
          })
          if (child.childDisposition === 'PUBLISH') return
          requireContentReady(
            await resolveMediaContentChildWrites(contentTx(tx), {
              owner,
              parent: contentHandle(input.parent),
              children: [
                { handle, resolution: { kind: 'PUBLISH', receipt: contentReceipt(file.uploadReceipt!.receipt) } }
              ],
              now: new Date()
            })
          )
        })
        selectedCount++
      } else {
        if (child.status === 'ROLLED_BACK' && child.resolutionEvidenceId) continue
        let disposition: 'RESTORED' | 'REMOVED' | 'ISOLATED' = 'RESTORED'
        let evidenceId = `replace-rollback:${input.parent.handle.writeId}:${child.id}`
        {
          if (handle.scope.kind !== 'PATH') throw new ContentWriteConflict()
          const source = await resolveContentPath(input.scanRoot, handle.scope.relativePath)
          const recovery = await resolveCreatablePathWithinRoot(
            input.scanRoot,
            path.join(input.scanRoot, '.pixishelf-upload-recovery', input.parent.handle.writeId, child.id)
          )
          await fs.mkdir(recovery, { recursive: true })
          const evidenceFile = path.join(recovery, 'manifest.json')
          const destination = path.join(recovery, 'media')
          const identity = {
            version: 1,
            parentWriteId: input.parent.handle.writeId,
            childWriteId: child.id,
            sourcePath: handle.scope.relativePath
          }
          const statOrMissing = async (file: string) =>
            fs.lstat(file, { bigint: true }).catch((error) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
          const sourceState = await statOrMissing(source.absolutePath)
          const destinationState = await statOrMissing(destination)
          const oldEvidence = await fs
            .readFile(evidenceFile, 'utf8')
            .then(JSON.parse)
            .catch((error) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
          if (
            oldEvidence &&
            (oldEvidence.parentWriteId !== identity.parentWriteId ||
              oldEvidence.childWriteId !== identity.childWriteId ||
              oldEvidence.sourcePath !== identity.sourcePath)
          ) {
            throw new ContentWriteConflict('恢复证据不匹配。')
          }
          if (destinationState) {
            if (
              sourceState ||
              !oldEvidence ||
              !destinationState.isFile() ||
              destinationState.nlink !== 1n ||
              destinationState.dev.toString() !== oldEvidence.deviceId ||
              destinationState.ino.toString() !== oldEvidence.inode ||
              destinationState.size.toString() !== oldEvidence.size ||
              destinationState.mtimeNs.toString() !== oldEvidence.mtimeNs
            ) {
              throw new ContentWriteConflict('恢复文件身份冲突。')
            }
            await writeRecoveryManifest(evidenceFile, { ...oldEvidence, state: 'ISOLATED' })
            disposition = 'ISOLATED'
          } else if (sourceState) {
            if (!sourceState.isFile() || sourceState.nlink !== 1n) {
              throw new ContentWriteConflict('上传残留身份异常，保留替换会话等待恢复。')
            }
            if (
              oldEvidence &&
              (oldEvidence.state !== 'MOVING' ||
                sourceState.dev.toString() !== oldEvidence.deviceId ||
                sourceState.ino.toString() !== oldEvidence.inode ||
                sourceState.size.toString() !== oldEvidence.size ||
                sourceState.mtimeNs.toString() !== oldEvidence.mtimeNs)
            ) {
              throw new ContentWriteConflict('上传残留在恢复期间变化。')
            }
            const evidence = {
              ...identity,
              size: sourceState.size.toString(),
              deviceId: sourceState.dev.toString(),
              inode: sourceState.ino.toString(),
              mtimeNs: sourceState.mtimeNs.toString(),
              ctimeNs: sourceState.ctimeNs.toString()
            }
            if (!oldEvidence) {
              await writeRecoveryManifest(evidenceFile, { ...evidence, state: 'MOVING' })
            }
            await fs.rename(source.absolutePath, destination)
            await writeRecoveryManifest(evidenceFile, { ...evidence, state: 'ISOLATED' })
            disposition = 'ISOLATED'
          } else {
            if (oldEvidence && oldEvidence.state !== 'ABSENT') throw new ContentWriteConflict('恢复文件丢失。')
            if (!oldEvidence) {
              await writeRecoveryManifest(evidenceFile, { ...identity, state: 'ABSENT' })
            }
            disposition = 'REMOVED'
          }
          evidenceId = `replace-residue:${input.parent.handle.writeId}:${child.id}`
        }
        await prisma.$transaction(async (tx) =>
          requireContentReady(
            await resolveMediaContentChildWrites(contentTx(tx), {
              owner,
              parent: contentHandle(input.parent),
              children: [{ handle, resolution: { kind: 'VERIFIED_ROLLBACK', disposition, evidenceId } }],
              now: new Date()
            })
          )
        )
      }
    }
    cursor = children.at(-1)!.id
  }
  if (!input.rollback && selectedCount !== selected.size) throw new ContentWriteConflict('替换清单与会话文件不一致。')
}

export async function completedReplacement(
  userId: string,
  auth: ContentWriteAuthorization,
  artworkId: number,
  action: 'commit' | 'rollback'
) {
  return prisma.$transaction(async (tx) => {
    const handle = requireContentReady(
      await getMediaContentWriteHandle(contentTx(tx), {
        owner: contentOwner(userId, auth.sessionId),
        writeId: auth.handle.writeId,
        writeToken: auth.handle.writeToken
      })
    )
    const row = await tx.mediaContentPathWrite.findUniqueOrThrow({ where: { id: handle.writeId } })
    if (row.status !== 'COMPLETED' && row.status !== 'ROLLED_BACK') return false
    if (
      handle.declarationVersion !== BigInt(auth.handle.declarationVersion) + 1n ||
      row.resolutionEvidenceId !== `replacement:${artworkId}:${action}` ||
      handle.directoryId !== auth.handle.directoryId ||
      handle.scope.kind !== 'DIRECTORY'
    ) {
      throw new ContentWriteConflict('替换会话已经以其他结果结束。')
    }
    return true
  })
}
