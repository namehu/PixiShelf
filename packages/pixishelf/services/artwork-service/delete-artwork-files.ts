import 'server-only'
import fs from 'fs/promises'
import path from 'path'
import type { Stats } from 'fs'
import { resolveExistingPathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import type { ArtworkDeleteEntry, ArtworkDeleteReport } from '@/schemas/artwork-delete.dto'
import { getChapterPathCandidates, validateChapterManifest } from './video-chapters'
import { parseMetadataFile } from '@/services/scan-service/metadata-parser'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'

export interface DeleteMediaInput {
  path: string
  chaptersPath: string | null
}
export interface DeleteFileReference {
  path: string
  directory: boolean
}
type Candidate = { path: string; kind: ArtworkDeleteEntry['kind']; reason: string; snapshot?: Stats }
const RESERVED_ROOTS = new Set(['sources', '.trash', '.archive-staging'])
const MAX_ENTRIES = 100_000
const MAX_DEPTH = 12

export function normalizeDeletePath(value: string): string {
  if (/^[a-z]:/i.test(value) || /^[/\\]{2}/.test(value) || value.includes('\0')) {
    throw new UnsafePathError('Invalid stored path')
  }
  const parts = value.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
  if (parts.some((part) => part === '..')) throw new UnsafePathError('Path traversal')
  const normalized = parts.filter((part) => part && part !== '.').join('/')
  if (!normalized) throw new UnsafePathError('Empty stored path')
  return normalized
}

function key(value: string) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}
export function withinDeleteDirectory(directory: string, value: string): boolean {
  return key(directory) === key(value) || key(value).startsWith(`${key(directory)}/`)
}

export function determineDeleteDirectory(input: {
  storagePath: string | null
  storageKey: string | null
  externalId: string | null
  metaSource: string | null
  artist: { userId: string | null } | null
  images: DeleteMediaInput[]
}): string | null {
  try {
    const first = input.images[0]
    const candidate =
      input.storagePath ||
      (first ? path.posix.dirname(normalizeDeletePath(first.path)) : null) ||
      (input.metaSource ? path.posix.dirname(normalizeDeletePath(input.metaSource)) : null) ||
      (input.artist?.userId && (input.storageKey || input.externalId)
        ? `${input.artist.userId}/${input.storageKey || input.externalId}`
        : null)
    if (!candidate) return null
    const directory = normalizeDeletePath(candidate)
    const parts = directory.split('/')
    if (parts.length < 2 || RESERVED_ROOTS.has(parts[0]!.toLowerCase())) return null
    if (parts[0]!.toLowerCase() === 'local-imports' && parts.length < 3) return null
    if (input.images.some((image) => !withinDeleteDirectory(directory, normalizeDeletePath(image.path)))) return null
    return directory
  } catch {
    return null
  }
}

export function fileErrorCode(error: unknown): string {
  if (error instanceof UnsafePathError) return 'UNSAFE_PATH'
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? code : 'IO_ERROR'
}

export class ArtworkFileDeletion {
  private root: string | null = null
  private readonly entries = new Map<string, number>()
  private readonly originals = new Map<string, Candidate>()
  private readonly sidecars = new Map<string, Candidate>()
  private readonly directories: string[] = []
  private references: DeleteFileReference[] = []
  private cleanupAllowed = false

  constructor(
    private readonly report: ArtworkDeleteReport,
    private readonly input: {
      scanRoot: string | null
      directory: string | null
      media: DeleteMediaInput[]
      metaSource: string | null
      pixivId: string | null
      metadataIdentityConflict?: boolean
    }
  ) {
    for (const image of input.media) {
      this.addOriginal(image.path, 'MEDIA', '数据库登记的作品媒体')
      if (image.chaptersPath) {
        if (isChapterManifestFileName(path.posix.basename(image.chaptersPath.replace(/\\/g, '/')))) {
          this.addOriginal(image.chaptersPath, 'CHAPTER', '数据库登记的章节文件')
        } else {
          this.record({
            path: image.chaptersPath,
            kind: 'CHAPTER',
            status: 'RETAINED',
            reason: '章节路径不符合章节文件命名',
            code: 'INVALID_CHAPTER_PATH'
          })
        }
      }
    }
  }

  private addOriginal(value: string, kind: Candidate['kind'], reason: string) {
    try {
      const normalized = normalizeDeletePath(value)
      if (!this.originals.has(key(normalized))) this.originals.set(key(normalized), { path: normalized, kind, reason })
    } catch {
      this.record({ path: value, kind, status: 'FAILED', reason: '不安全的存储路径，未执行删除', code: 'UNSAFE_PATH' })
    }
  }

  private record(entry: ArtworkDeleteEntry) {
    const index = this.entries.get(key(entry.path))
    if (index === undefined) {
      this.entries.set(key(entry.path), this.report.entries.length)
      this.report.entries.push(entry)
    } else this.report.entries[index] = entry
  }

  private referenced(value: string) {
    return this.references.some(
      (reference) =>
        key(value) === key(reference.path) || (reference.directory && withinDeleteDirectory(reference.path, value))
    )
  }

  /** All segments below the configured root must be real directories, never symlinks/junctions. */
  private async safePath(relative: string): Promise<string> {
    if (!this.root) throw new UnsafePathError('Scan root unavailable')
    let current = this.root
    for (const part of normalizeDeletePath(relative).split('/')) {
      current = path.join(current, part)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new UnsafePathError('Symbolic link')
    }
    return resolveExistingPathWithinRoot(this.root, current)
  }

  async prepare(references: DeleteFileReference[]) {
    this.references = references.flatMap((reference) => {
      try {
        return [{ ...reference, path: normalizeDeletePath(reference.path) }]
      } catch {
        return []
      }
    })
    if (!this.input.scanRoot) {
      this.report.warnings.push('未配置扫描根目录，未执行物理文件和目录清理。')
      return
    }
    try {
      this.root = await fs.realpath(this.input.scanRoot)
      if (!(await fs.stat(this.root)).isDirectory()) throw new UnsafePathError('Not a directory')
    } catch (error) {
      this.report.warnings.push(`扫描根目录不可用（${fileErrorCode(error)}），未执行物理清理。`)
      this.root = null
      return
    }
    const directory = this.input.directory
    if (!directory) {
      this.report.warnings.push('无法确认独立的作品目录，跳过附属文件和空目录清理。')
      return
    }
    if (
      this.references.some(
        (reference) =>
          withinDeleteDirectory(directory, reference.path) ||
          (reference.directory && withinDeleteDirectory(reference.path, directory))
      )
    ) {
      this.record({
        path: directory,
        kind: 'DIRECTORY',
        status: 'RETAINED',
        reason: '其他作品或媒体引用此目录，内部未检查',
        code: 'SHARED_DIRECTORY'
      })
      this.report.warnings.push('作品目录存在共享引用，跳过新增清理；目录内部未检查。')
      return
    }
    try {
      await this.safePath(directory)
      this.cleanupAllowed = true
      await this.inspect(directory)
      this.report.inspectionComplete = true
    } catch (error) {
      const code = fileErrorCode(error)
      this.cleanupAllowed = false
      this.report.inspectionComplete = false
      this.record({
        path: directory,
        kind: 'DIRECTORY',
        status: code === 'ENOENT' ? 'MISSING' : 'RETAINED',
        reason: code === 'ENOENT' ? '作品目录原本不存在' : '目录未完整检查，跳过新增清理',
        code
      })
      if (code !== 'ENOENT') this.report.warnings.push(`作品目录未完整检查（${code}），跳过新增清理。`)
    }
  }

  private async inspect(directory: string) {
    const pending = [{ directory, depth: 0 }]
    let visited = 0
    const chapterPaths = new Set(
      this.input.media
        .flatMap((media) => getChapterPathCandidates(media.path))
        .map((value) => {
          try {
            return key(normalizeDeletePath(value))
          } catch {
            return ''
          }
        })
    )
    let metaSource: string | null = null
    try {
      metaSource = this.input.metaSource ? normalizeDeletePath(this.input.metaSource) : null
    } catch {
      /* untrusted path */
    }
    while (pending.length) {
      const next = pending.pop()!
      if (next.depth > MAX_DEPTH) throw Object.assign(new Error('Directory depth limit'), { code: 'INSPECTION_LIMIT' })
      this.directories.push(next.directory)
      const absolute = await this.safePath(next.directory)
      const handle = await fs.opendir(absolute)
      for await (const entry of handle) {
        if (++visited > MAX_ENTRIES) {
          throw Object.assign(new Error('Directory entry limit'), { code: 'INSPECTION_LIMIT' })
        }
        const relative = `${next.directory}/${entry.name}`
        if (this.originals.has(key(relative))) continue
        if (entry.isSymbolicLink()) {
          this.record({
            path: relative,
            kind: 'OTHER',
            status: 'RETAINED',
            reason: '符号链接或 junction 保留，不检查目标',
            code: 'SYMLINK'
          })
        } else if (entry.isDirectory()) pending.push({ directory: relative, depth: next.depth + 1 })
        else if (entry.isFile()) {
          const match = entry.name.match(/^(\d+)(?:_p\d+)?-meta\.(json|txt)$/i)
          const registeredMeta =
            metaSource && key(metaSource) === key(relative) && /-meta\.(json|txt)$/i.test(entry.name)
          const namedMeta = match && this.input.pixivId && match[1] === this.input.pixivId
          const chapter = chapterPaths.has(key(relative))
          if (!registeredMeta && !namedMeta && !chapter) {
            if (!this.entries.has(key(relative))) {
              this.record({
                path: relative,
                kind: 'OTHER',
                status: 'RETAINED',
                reason: '未登记或不在可确认归属的附属文件名单内'
              })
            }
            continue
          }
          const kind = chapter ? 'CHAPTER' : 'METADATA'
          try {
            const file = await this.safePath(relative)
            const snapshot = await fs.lstat(file)
            if (!snapshot.isFile()) throw new UnsafePathError('Not a regular file')
            const maxSize = chapter ? 5 * 1024 * 1024 : 16 * 1024 * 1024
            if (snapshot.size > maxSize) {
              throw Object.assign(new Error('Sidecar size limit'), { code: 'SIDECAR_TOO_LARGE' })
            }
            if (chapter) await validateChapterManifest(JSON.parse(await fs.readFile(file, 'utf8')))
            else {
              const parsed = await parseMetadataFile(file)
              if (
                this.input.metadataIdentityConflict ||
                !parsed.success ||
                (this.input.pixivId && parsed.metadata?.id !== this.input.pixivId)
              ) {
                throw Object.assign(new Error('Identity mismatch'), { code: 'METADATA_IDENTITY_MISMATCH' })
              }
            }
            const candidate = {
              path: relative,
              kind,
              reason: chapter
                ? '与已登记视频同名且通过校验的章节文件'
                : registeredMeta
                  ? '数据库登记的作品元数据'
                  : '文件名和内容匹配该作品 Pixiv 身份',
              snapshot
            } satisfies Candidate
            this.sidecars.set(key(relative), candidate)
            this.record({
              path: relative,
              kind,
              status: 'NOT_ATTEMPTED',
              reason: '已确认候选，等待原文件和数据库删除完成'
            })
          } catch (error) {
            this.record({
              path: relative,
              kind,
              status: 'RETAINED',
              reason: '附属文件校验失败，保留文件',
              code: fileErrorCode(error)
            })
          }
        } else this.record({ path: relative, kind: 'OTHER', status: 'RETAINED', reason: '非普通文件，保留' })
      }
    }
  }

  private async remove(candidate: Candidate): Promise<boolean> {
    if (!this.root) {
      this.record({ path: candidate.path, kind: candidate.kind, status: 'NOT_ATTEMPTED', reason: '扫描根目录不可用' })
      return false
    }
    if (this.referenced(candidate.path)) {
      this.record({
        path: candidate.path,
        kind: candidate.kind,
        status: 'RETAINED',
        reason: '其他作品或媒体仍引用此路径',
        code: 'SHARED_FILE'
      })
      return false
    }
    try {
      const absolute = await this.safePath(candidate.path)
      const current = await fs.lstat(absolute)
      if (!current.isFile()) throw new UnsafePathError('Not a regular file')
      const before = candidate.snapshot
      if (
        before &&
        (before.ino !== current.ino ||
          before.dev !== current.dev ||
          before.size !== current.size ||
          before.mtimeMs !== current.mtimeMs ||
          before.ctimeMs !== current.ctimeMs)
      ) {
        throw Object.assign(new Error('File changed'), { code: 'FILE_CHANGED' })
      }
      await fs.unlink(absolute)
      this.record({ path: candidate.path, kind: candidate.kind, status: 'DELETED', reason: candidate.reason })
      return true
    } catch (error) {
      const code = fileErrorCode(error)
      this.record({
        path: candidate.path,
        kind: candidate.kind,
        status: code === 'ENOENT' ? 'MISSING' : 'FAILED',
        reason: code === 'ENOENT' ? '文件原本不存在，本次未删除' : '文件删除未完成，未强制重试',
        code
      })
      return code === 'ENOENT'
    }
  }

  async deleteOriginals(): Promise<boolean> {
    let succeeded = !this.report.entries.some((entry) => entry.status === 'FAILED')
    for (const candidate of this.originals.values()) {
      if (!(await this.remove(candidate))) succeeded = false
    }
    return succeeded
  }

  async cleanup(allowed: boolean) {
    if (!allowed || !this.cleanupAllowed) {
      for (const candidate of this.sidecars.values()) {
        this.record({
          path: candidate.path,
          kind: candidate.kind,
          status: 'NOT_ATTEMPTED',
          reason: '原文件、数据库或目录检查未全部完成，保留附属文件'
        })
      }
      for (const directory of this.directories) {
        if (!this.entries.has(key(directory))) {
          this.record({
            path: directory,
            kind: 'DIRECTORY',
            status: 'NOT_ATTEMPTED',
            reason: '前置步骤未全部完成，未清理目录'
          })
        }
      }
      return
    }
    for (const candidate of this.sidecars.values()) await this.remove(candidate)
    for (const directory of this.directories.sort((a, b) => b.split('/').length - a.split('/').length)) {
      try {
        const absolute = await this.safePath(directory)
        await fs.rmdir(absolute)
        this.record({ path: directory, kind: 'DIRECTORY', status: 'DELETED', reason: '作品范围内的空目录' })
      } catch (error) {
        const code = fileErrorCode(error)
        this.record({
          path: directory,
          kind: 'DIRECTORY',
          status: code === 'ENOENT' ? 'MISSING' : ['ENOTEMPTY', 'EEXIST'].includes(code) ? 'RETAINED' : 'FAILED',
          reason:
            code === 'ENOENT'
              ? '目录原本不存在'
              : ['ENOTEMPTY', 'EEXIST'].includes(code)
                ? '目录仍有内容，保留'
                : '空目录清理失败，未强制删除',
          code
        })
      }
    }
  }

  markUnattempted(reason: string) {
    for (const candidate of this.originals.values()) {
      if (!this.entries.has(key(candidate.path))) {
        this.record({ path: candidate.path, kind: candidate.kind, status: 'NOT_ATTEMPTED', reason })
      }
    }
  }
}
