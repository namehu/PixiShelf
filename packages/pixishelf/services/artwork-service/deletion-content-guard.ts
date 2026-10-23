import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { beginMediaContentPathWrite, beginMediaContentSourceWrite, resumeMediaContentSourceWrite } from '@pixishelf/db'
import { prisma, type AppTransaction } from '@/lib/prisma'
import { resolveCreatablePathWithinRoot } from '@/lib/safe-path'
import { ContentWriteAuthorizationSchema } from '@/schemas/media-content.dto'
import {
  ArtworkDeletePreviewSchema,
  ArtworkDeleteReportSchema,
  type ArtworkDeleteEntry
} from '@/schemas/artwork-delete.dto'
import {
  contentAuthorization,
  contentOwner,
  contentTx,
  ContentWriteConflict,
  publishContentOwner,
  requireContentReady,
  resolveContentPath
} from './content-source-guard'
import { writeRecoveryManifest } from './recovery-manifest'
import { withReplaceWriteLock } from './replace-write-lock'
import { fileErrorCode, normalizeDeletePath } from './delete-artwork-files'

const identitySchema = z.object({
  dev: z.string(),
  ino: z.string(),
  size: z.string(),
  mtimeNs: z.string(),
  ctimeNs: z.string()
})
const manifestSchema = z.object({
  version: z.literal(1),
  operationId: z.string().uuid(),
  userId: z.string(),
  kind: z.enum(['ARTWORK', 'IMAGE', 'CHAPTERS']),
  targetId: z.number().int().positive(),
  rootIdentity: z.string(),
  writeToken: z.string().uuid(),
  relativeDirectory: z.string(),
  artworkIds: z.array(z.number().int()),
  imageIds: z.array(z.number().int()),
  members: z.string(),
  selectedPaths: z.array(z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(['MEDIA', 'CHAPTER', 'METADATA', 'OTHER']),
      reason: z.string(),
      identity: identitySchema.nullable(),
      state: z.enum(['PENDING', 'ABSENT'])
    })
  ),
  directories: z.array(z.object({ path: z.string(), dev: z.string(), ino: z.string(), removed: z.boolean() })),
  authorization: ContentWriteAuthorizationSchema.nullable(),
  preview: ArtworkDeletePreviewSchema.nullable(),
  report: ArtworkDeleteReportSchema.nullable()
})
export type DeletionManifest = z.infer<typeof manifestSchema>
export type DeletionKind = DeletionManifest['kind']
type Target = { scanRoot: string; userId: string; kind: DeletionKind; targetId: number }
export type DeletionPlan = {
  selectedPaths: string[]
  files: Array<{ path: string; kind: DeletionManifest['files'][number]['kind']; reason: string }>
  directories: string[]
  scopePaths: string[]
  artworkIds: number[]
  imageIds: number[]
  members: string
  preview?: DeletionManifest['preview']
  report?: DeletionManifest['report']
}
export const deletionMembers = (value: unknown) =>
  JSON.stringify(value, (_key, field) => (typeof field === 'bigint' ? field.toString() : field))
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const identity = (stat: Awaited<ReturnType<typeof statFile>>) =>
  stat && {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString()
  }
async function statFile(absolute: string) {
  return fs.lstat(absolute, { bigint: true }).catch((error) => {
    if (missing(error)) return null
    throw error
  })
}
async function safeFile(scanRoot: string, relative: string) {
  if (
    normalizeDeletePath(relative) !== relative ||
    relative
      .split('/')
      .some((part) =>
        [
          '.pixishelf-upload-recovery',
          '.replace-write-lock',
          '.pixishelf-root',
          '.trash',
          '.archive-staging',
          'sources'
        ].includes(part)
      )
  ) {
    throw new ContentWriteConflict('删除路径不安全。')
  }
  let current = await fs.realpath(scanRoot)
  for (const segment of relative.split('/')) {
    current = path.join(current, segment)
    const stat = await statFile(current)
    if (stat?.isSymbolicLink()) throw new ContentWriteConflict('删除路径包含符号链接。')
  }
  return resolveCreatablePathWithinRoot(await fs.realpath(scanRoot), current)
}
async function location(target: Target, create = false) {
  if (!Number.isSafeInteger(target.targetId) || target.targetId <= 0) throw new ContentWriteConflict()
  const context = await resolveContentPath(target.scanRoot, '.deletion-identity')
  const root = path.dirname(context.absolutePath)
  let current = root
  for (const segment of [
    '.pixishelf-upload-recovery',
    'deletions',
    `${target.kind.toLowerCase()}-${target.targetId}`
  ]) {
    const parent = current
    current = await resolveCreatablePathWithinRoot(root, path.join(current, segment))
    if (create) {
      await fs.mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      const dir = await fs.open(parent, 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    }
    const stat = await statFile(current)
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new ContentWriteConflict('恢复目录身份不符。')
  }
  return { directory: current, file: path.join(current, 'manifest.json'), rootIdentity: context.directory.rootIdentity }
}
async function readAt(target: Target, place: Awaited<ReturnType<typeof location>>) {
  const stat = await statFile(place.file)
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new ContentWriteConflict('恢复清单身份不符。')
  const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(place.file, 'utf8')))
  if (
    manifest.kind !== target.kind ||
    manifest.targetId !== target.targetId ||
    manifest.rootIdentity !== place.rootIdentity
  ) {
    throw new ContentWriteConflict('删除操作属于其他账户或原媒体根已变化。')
  }
  return manifest
}
async function completed(manifest: DeletionManifest) {
  const claim = await prisma.mediaContentPathWrite.findUnique({
    where: { writeToken: manifest.writeToken },
    include: { directory: true }
  })
  if (!claim) {
    if (manifest.authorization) throw new ContentWriteConflict('删除声明缺失，保留恢复清单。')
    return false
  }
  if (
    claim.ownerUserId !== manifest.userId ||
    claim.sessionId !== manifest.operationId ||
    claim.sessionVersion !== 1n ||
    claim.jobId !== null ||
    claim.scope !== 'DIRECTORY' ||
    claim.parentWriteId !== null ||
    claim.directory.rootIdentity !== manifest.rootIdentity ||
    claim.directory.relativeDirectory !== manifest.relativeDirectory ||
    (manifest.authorization &&
      (claim.id !== manifest.authorization.handle.writeId ||
        claim.declarationVersion !==
          BigInt(manifest.authorization.handle.declarationVersion) + (claim.status === 'COMPLETED' ? 1n : 0n)))
  ) {
    throw new ContentWriteConflict('删除声明与原操作不一致。')
  }
  if (claim.status === 'COMPLETED') return true
  if (claim.status !== 'ACTIVE') throw new ContentWriteConflict('删除状态无法确认，保留原声明。')
  return false
}
export async function readDeletionIntent(target: Target) {
  const manifest = await readAt(target, await location(target))
  if (!manifest) return null
  const done = await completed(manifest)
  if (manifest.userId !== target.userId) {
    if (done) return null
    throw new ContentWriteConflict('删除操作属于其他账户。')
  }
  return { manifest, completed: done }
}
function commonDirectory(paths: string[]) {
  const parents = paths.map((item) =>
    path.posix
      .dirname(normalizeDeletePath(item))
      .split('/')
      .filter((part) => part !== '.')
  )
  const common = parents[0] ?? []
  for (const parts of parents.slice(1)) {
    let i = 0
    while (i < common.length && common[i] === parts[i]) i++
    common.length = i
  }
  return common.join('/')
}
async function freeze(
  target: Target,
  operationId: string,
  rootIdentity: string,
  plan: DeletionPlan
): Promise<DeletionManifest> {
  const files: DeletionManifest['files'] = []
  if (
    new Set(plan.selectedPaths).size !== plan.selectedPaths.length ||
    plan.files.length !== plan.selectedPaths.length
  ) {
    throw new ContentWriteConflict()
  }
  for (const item of plan.files) {
    if (!plan.selectedPaths.includes(item.path)) throw new ContentWriteConflict()
    const stat = await statFile(await safeFile(target.scanRoot, item.path))
    if (stat && (!stat.isFile() || stat.nlink !== 1n)) throw new ContentWriteConflict('只能删除原普通文件。')
    files.push({ ...item, identity: identity(stat), state: stat ? 'PENDING' : 'ABSENT' })
  }
  const directories: DeletionManifest['directories'] = []
  for (const relative of plan.directories) {
    const stat = await statFile(await safeFile(target.scanRoot, relative))
    if (stat) {
      if (!stat.isDirectory()) throw new ContentWriteConflict()
      directories.push({ path: relative, dev: stat.dev.toString(), ino: stat.ino.toString(), removed: false })
    }
  }
  return {
    version: 1,
    operationId,
    userId: target.userId,
    kind: target.kind,
    targetId: target.targetId,
    rootIdentity,
    writeToken: randomUUID(),
    relativeDirectory: commonDirectory([...plan.scopePaths, ...plan.selectedPaths]),
    artworkIds: plan.artworkIds,
    imageIds: plan.imageIds,
    members: plan.members,
    selectedPaths: plan.selectedPaths,
    files,
    directories,
    authorization: null,
    preview: plan.preview ?? null,
    report: plan.report ?? null
  }
}
function record(manifest: DeletionManifest, entry: ArtworkDeleteEntry) {
  if (!manifest.report) return
  const index = manifest.report.entries.findIndex((item) => item.path === entry.path)
  if (index < 0) manifest.report.entries.push(entry)
  else manifest.report.entries[index] = entry
}
async function removeFiles(target: Target, manifest: DeletionManifest, save: () => Promise<void>) {
  for (const file of manifest.files) {
    try {
      const absolute = await safeFile(target.scanRoot, file.path)
      const stat = await statFile(absolute)
      if (stat) {
        if (
          file.state === 'ABSENT' ||
          !stat.isFile() ||
          stat.nlink !== 1n ||
          JSON.stringify(identity(stat)) !== JSON.stringify(file.identity)
        ) {
          throw new ContentWriteConflict('原删除路径被新文件占用或文件身份已变化，已停止。')
        }
        await fs.unlink(absolute)
        const parent = await fs.open(path.dirname(absolute), 'r')
        try {
          await parent.sync()
        } finally {
          await parent.close()
        }
      }
      file.state = 'ABSENT'
      record(manifest, {
        path: file.path,
        kind: file.kind,
        status: file.identity ? 'DELETED' : 'MISSING',
        reason: file.identity ? '原删除清单中的文件已确认不存在' : '文件在原清单中已不存在'
      })
      await save()
    } catch (error) {
      record(manifest, {
        path: file.path,
        kind: file.kind,
        status: 'FAILED',
        reason: '删除未完成，保留原意图供重试',
        code: fileErrorCode(error)
      })
      throw error
    }
  }
  // Only frozen directories, never recursive rm. A newly created child keeps its parent intact.
  for (const directory of [...manifest.directories].sort(
    (a, b) => b.path.split('/').length - a.path.split('/').length
  )) {
    const absolute = await safeFile(target.scanRoot, directory.path)
    const stat = await statFile(absolute)
    if (
      stat &&
      (directory.removed ||
        !stat.isDirectory() ||
        stat.dev.toString() !== directory.dev ||
        stat.ino.toString() !== directory.ino)
    ) {
      throw new ContentWriteConflict('原目录身份已变化。')
    }
    if (stat) {
      try {
        await fs.rmdir(absolute)
        const parent = await fs.open(path.dirname(absolute), 'r')
        try {
          await parent.sync()
        } finally {
          await parent.close()
        }
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        record(manifest, { path: directory.path, kind: 'DIRECTORY', status: 'RETAINED', reason: '目录仍有内容，保留' })
        continue
      }
    }
    directory.removed = true
    record(manifest, {
      path: directory.path,
      kind: 'DIRECTORY',
      status: 'DELETED',
      reason: '原清单中的空目录已确认不存在'
    })
    await save()
  }
  await save()
}

/** No file work occurs until both the frozen manifest and its exact claim are durable. */
export async function executeDeletion<T>(
  input: Target & {
    operationId?: string
    selectedPaths?: string[]
    prepare: () => Promise<DeletionPlan>
    verifyMembers: (tx: AppTransaction, members: string) => Promise<void>
    publish: (tx: AppTransaction, manifest: DeletionManifest) => Promise<T>
  }
) {
  if (!input.operationId || !z.string().uuid().safeParse(input.operationId).success) {
    throw new ContentWriteConflict('请重新打开删除预览，使用原操作重试。')
  }
  const place = await location(input, true)
  return withReplaceWriteLock(
    place.directory,
    async () => {
      const history = await readAt(input, { ...place, file: path.join(place.directory, `${input.operationId}.json`) })
      if (history) {
        if (
          history.userId !== input.userId ||
          history.operationId !== input.operationId ||
          !(await completed(history))
        ) {
          throw new ContentWriteConflict('历史删除操作不匹配。')
        }
        return { manifest: history, result: undefined, replay: true }
      }
      let manifest = await readAt(input, place)
      if (manifest && manifest.operationId !== input.operationId) {
        if (!(await completed(manifest))) throw new ContentWriteConflict('已有未完成删除，请重新打开预览重试原操作。')
        await writeRecoveryManifest(path.join(place.directory, `${manifest.operationId}.json`), manifest)
        manifest = null
      }
      if (manifest && manifest.userId !== input.userId) throw new ContentWriteConflict('删除操作属于其他账户。')
      if (!manifest) {
        manifest = await freeze(input, input.operationId!, place.rootIdentity, await input.prepare())
        await writeRecoveryManifest(place.file, manifest)
      }
      if (
        input.selectedPaths &&
        JSON.stringify([...input.selectedPaths].sort()) !== JSON.stringify([...manifest.selectedPaths].sort())
      ) {
        throw new ContentWriteConflict('必须使用原删除选择重试。')
      }
      if (await completed(manifest)) return { manifest, result: undefined, replay: true }
      const current = manifest
      const save = () => writeRecoveryManifest(place.file, current)
      const context = await resolveContentPath(
        input.scanRoot,
        path.join(current.relativeDirectory, '.deletion-identity')
      )
      if (context.directory.rootIdentity !== current.rootIdentity) throw new ContentWriteConflict()
      current.authorization = await prisma.$transaction(async (tx) => {
        const previous = await tx.mediaContentPathWrite.findUnique({ where: { writeToken: current.writeToken } })
        const handle = requireContentReady(
          await beginMediaContentPathWrite(contentTx(tx), {
            directory: context.directory,
            scope: { kind: 'DIRECTORY' },
            owner: contentOwner(input.userId, current.operationId),
            writeToken: current.writeToken,
            upload: null,
            parent: null,
            now: new Date()
          })
        )
        const source = { artworkIds: current.artworkIds, imageIds: current.imageIds, writeToken: current.writeToken }
        if (previous) requireContentReady(await resumeMediaContentSourceWrite(contentTx(tx), { token: source }))
        else await beginMediaContentSourceWrite(contentTx(tx), { ...source, now: new Date() })
        await input.verifyMembers(tx, current.members)
        return contentAuthorization(current.operationId, handle)
      })
      await save()
      try {
        await removeFiles(input, current, save)
        const result = await prisma
          .$transaction((tx) =>
            publishContentOwner(tx, input.userId, [current.authorization!], 'committed', async (inner) => {
              await input.verifyMembers(inner, current.members)
              return input.publish(inner, current)
            })
          )
          .catch((error) => {
            if (current.report) {
              current.report.database.artwork = 'FAILED'
              current.report.database.media = 'FAILED'
            }
            throw error
          })
        return { manifest: current, result, replay: false }
      } catch (error) {
        // Preserve the original failure even if the recovery disk is also unavailable.
        await save().catch(() => undefined)
        throw error
      }
    },
    { waitMs: 0 }
  )
}
