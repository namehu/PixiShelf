import 'server-only'
import fs from 'fs/promises'
import path from 'path'
import type { Stats } from 'fs'
import { resolveExistingPathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import type {
  ArtworkDeleteEntry,
  ArtworkDeleteReport,
  ArtworkDeletePreview,
  ArtworkDeletePreviewEntry
} from '@/schemas/artwork-delete.dto'
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
  images: DeleteMediaInput[]
}): string | null {
  try {
    const first = input.images[0]
    const candidate =
      input.storagePath ||
      (first ? path.posix.dirname(normalizeDeletePath(first.path)) : null) ||
      (input.metaSource ? path.posix.dirname(normalizeDeletePath(input.metaSource)) : null)
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
  private readonly candidates = new Map<string, Candidate>()
  private readonly previewEntries = new Map<string, ArtworkDeletePreviewEntry>()
  private readonly originals = new Map<string, Candidate>()
  private readonly directories: string[] = []
  private references: DeleteFileReference[] = []
  private cleanupAllowed = false
  private canDelete = false
  private directoryMode: ArtworkDeletePreview['directoryMode'] = 'REGISTERED_ONLY'

  constructor(
    private readonly report: ArtworkDeleteReport,
    private readonly input: {
      scanRoot: string | null
      directory: string | null
      media: DeleteMediaInput[]
      metaSource: string | null
    }
  ) {
    for (const image of input.media) {
      this.addOriginal(image.path, 'MEDIA', '数据库登记的作品媒体')
      if (image.chaptersPath) {
        if (isChapterManifestFileName(path.posix.basename(image.chaptersPath.replace(/\\/g, '/')))) {
          this.addOriginal(image.chaptersPath, 'CHAPTER', '数据库登记的章节文件')
        } else {
          this.block(image.chaptersPath, 'CHAPTER', '章节路径不符合章节文件命名', 'INVALID_CHAPTER_PATH')
        }
      }
    }
  }

  private addOriginal(value: string, kind: Candidate['kind'], reason: string) {
    try {
      const normalized = normalizeDeletePath(value)
      // A media path takes precedence if another row also registers it as a chapter.
      if (!this.originals.has(key(normalized)) || kind === 'MEDIA') {
        this.originals.set(key(normalized), { path: normalized, kind, reason })
      }
    } catch {
      // Do not return a potentially absolute, malformed stored path to the browser.
      this.block(path.posix.basename(value.replace(/\\/g, '/')), kind, '不安全的存储路径，保留文件', 'UNSAFE_PATH')
    }
  }

  private record(entry: ArtworkDeleteEntry) {
    const index = this.entries.get(key(entry.path))
    if (index === undefined) {
      this.entries.set(key(entry.path), this.report.entries.length)
      this.report.entries.push(entry)
    } else this.report.entries[index] = entry
  }

  private block(relative: string, kind: Candidate['kind'], reason: string, code?: string) {
    try {
      relative = normalizeDeletePath(relative)
    } catch {
      relative = path.posix.basename(relative.replace(/\\/g, '/'))
    }
    this.previewEntries.set(key(relative), { path: relative, kind, selection: 'BLOCKED', missing: false, reason, code })
    this.record({ path: relative, kind, status: 'RETAINED', reason, code })
  }

  private referenced(value: string) {
    return this.references.some(
      (reference) =>
        key(value) === key(reference.path) || (reference.directory && withinDeleteDirectory(reference.path, value))
    )
  }

  private reserved(value: string) {
    return value
      .split('/')
      .some((part) => RESERVED_ROOTS.has(part.toLowerCase()) || part.toLowerCase() === '.pixishelf-root')
  }

  /** Every segment is checked before resolving, so a link within the root is also rejected. */
  private async safePath(relative: string): Promise<string> {
    if (!this.root) throw new UnsafePathError('Scan root unavailable')
    let current = this.root
    for (const part of normalizeDeletePath(relative).split('/')) {
      current = path.join(current, part)
      if ((await fs.lstat(current)).isSymbolicLink()) throw new UnsafePathError('Symbolic link')
    }
    return resolveExistingPathWithinRoot(this.root, current)
  }

  private async inspectFile(candidate: Candidate, required: boolean) {
    if (this.reserved(candidate.path)) {
      this.block(candidate.path, candidate.kind, '系统保留路径，不允许删除', 'RESERVED_PATH')
      return
    }
    if (this.referenced(candidate.path)) {
      this.block(candidate.path, candidate.kind, '其他作品或媒体仍引用此路径', 'SHARED_FILE')
      return
    }
    let missing = false
    try {
      const snapshot = await fs.lstat(await this.safePath(candidate.path))
      if (!snapshot.isFile()) throw new UnsafePathError('Not a regular file')
      candidate.snapshot = snapshot
    } catch (error) {
      const code = fileErrorCode(error)
      if (code === 'ENOENT') missing = true
      else {
        this.block(candidate.path, candidate.kind, '文件无法安全检查，保留文件', code)
        if (code !== 'UNSAFE_PATH') this.canDelete = false
        return
      }
    }
    this.candidates.set(key(candidate.path), candidate)
    this.previewEntries.set(key(candidate.path), {
      path: candidate.path,
      kind: candidate.kind,
      selection: required ? 'REQUIRED' : 'OPTIONAL',
      missing,
      reason: missing ? '文件原本不存在；可完成记录删除' : candidate.reason
    })
    this.record({
      path: candidate.path,
      kind: candidate.kind,
      status: missing ? 'MISSING' : 'NOT_ATTEMPTED',
      reason: missing ? '文件原本不存在' : '等待确认选择'
    })
  }

  async prepare(references: DeleteFileReference[]) {
    this.references = references.map((reference) => ({ ...reference, path: normalizeDeletePath(reference.path) }))
    try {
      if (!this.input.scanRoot) throw new UnsafePathError('Scan root unavailable')
      this.root = await fs.realpath(this.input.scanRoot)
      if (!(await fs.stat(this.root)).isDirectory()) throw new UnsafePathError('Not a directory')
    } catch (error) {
      this.report.warnings.push(`扫描根目录不可用（${fileErrorCode(error)}），无法确认删除清单。`)
      for (const candidate of this.originals.values()) this.block(candidate.path, candidate.kind, '扫描根目录不可用')
      return
    }
    this.canDelete = true
    for (const candidate of this.originals.values()) await this.inspectFile(candidate, candidate.kind === 'MEDIA')
    const directory = this.input.directory
    if (!directory || this.reserved(directory)) {
      this.report.warnings.push('无法确认独立作品目录：仅处理登记文件，其他文件未检查；共享文件保留。')
      return
    }
    const shared = this.references.some(
      (reference) =>
        withinDeleteDirectory(directory, reference.path) ||
        (reference.directory && withinDeleteDirectory(reference.path, directory))
    )
    this.directoryMode = shared ? 'SHARED_DIRECTORY' : 'WORK_DIRECTORY'
    this.cleanupAllowed = !shared
    if (shared) this.report.warnings.push('目录被其他作品或媒体共用：额外文件仅供查看，不可选择，目录保留。')
    try {
      await this.inspect(directory, shared)
      this.report.inspectionComplete = this.canDelete
    } catch (error) {
      const code = fileErrorCode(error)
      this.cleanupAllowed = false
      // A missing top-level directory is a complete observation, including on a retry.
      if (code === 'ENOENT' && this.directories.length === 0) {
        this.report.inspectionComplete = true
        this.previewEntries.set(key(directory), {
          path: directory,
          kind: 'DIRECTORY',
          selection: 'BLOCKED',
          missing: true,
          reason: '作品目录原本不存在'
        })
        this.record({ path: directory, kind: 'DIRECTORY', status: 'MISSING', reason: '作品目录原本不存在', code })
      } else {
        this.canDelete = false
        this.report.inspectionComplete = false
        this.block(directory, 'DIRECTORY', '目录未完整检查，禁止删除', code)
        this.report.warnings.push(`作品目录未完整检查（${code}），请解决问题后重新加载。`)
      }
    }
  }

  private async inspect(directory: string, shared: boolean) {
    const pending = [{ directory, depth: 0 }]
    let visited = 0
    while (pending.length) {
      const next = pending.pop()!
      if (next.depth > MAX_DEPTH) throw Object.assign(new Error('Directory depth limit'), { code: 'INSPECTION_LIMIT' })
      const absolute = await this.safePath(next.directory)
      const handle = await fs.opendir(absolute)
      this.directories.push(next.directory)
      this.previewEntries.set(key(next.directory), {
        path: next.directory,
        kind: 'DIRECTORY',
        selection: shared ? 'BLOCKED' : 'DIRECTORY',
        missing: false,
        reason: shared ? '共享目录保留' : '只在清空后删除目录'
      })
      this.record({
        path: next.directory,
        kind: 'DIRECTORY',
        status: shared ? 'RETAINED' : 'NOT_ATTEMPTED',
        reason: shared ? '共享目录保留' : '等待文件和数据库处理完成'
      })
      for await (const entry of handle) {
        if (++visited > MAX_ENTRIES) {
          throw Object.assign(new Error('Directory entry limit'), { code: 'INSPECTION_LIMIT' })
        }
        const relative = `${next.directory}/${entry.name}`
        if (this.previewEntries.has(key(relative))) continue
        if (this.reserved(relative)) {
          this.block(
            relative,
            entry.isDirectory() ? 'DIRECTORY' : 'OTHER',
            '系统保留路径，不检查内部、不允许删除',
            'RESERVED_PATH'
          )
        } else if (entry.isSymbolicLink()) {
          this.block(relative, 'OTHER', '符号链接或 junction 保留，不检查目标', 'SYMLINK')
        } else if (entry.isDirectory()) pending.push({ directory: relative, depth: next.depth + 1 })
        else if (entry.isFile()) {
          const kind = isChapterManifestFileName(entry.name)
            ? 'CHAPTER'
            : /-meta\.(json|txt)$/i.test(entry.name)
              ? 'METADATA'
              : 'OTHER'
          if (shared) this.block(relative, kind, '共享目录中的额外文件保留', 'SHARED_DIRECTORY')
          else await this.inspectFile({ path: relative, kind, reason: '用户在作品目录清单中选中的附属文件' }, false)
        } else this.block(relative, 'OTHER', '非普通文件，保留')
      }
    }
  }

  preview(): ArtworkDeletePreview {
    return {
      artwork: this.report.artwork,
      mode: this.report.mode,
      directoryMode: this.directoryMode,
      canDelete: this.canDelete,
      inspectionComplete: this.report.inspectionComplete,
      warnings: this.report.warnings,
      entries: [...this.previewEntries.values()].sort((a, b) => a.path.localeCompare(b.path))
    }
  }

  /** Validate the whole selection before the first unlink; never widen it to newly found files. */
  async deleteSelected(selectedPaths: string[]): Promise<boolean> {
    if (!this.canDelete) throw new Error('Incomplete delete inspection')
    const selected = new Set<string>()
    for (const relative of selectedPaths) {
      if (normalizeDeletePath(relative) !== relative || !this.candidates.has(key(relative))) {
        throw new UnsafePathError('Invalid selection')
      }
      selected.add(key(relative))
    }
    for (const entry of this.previewEntries.values()) {
      if (entry.selection === 'REQUIRED' && !selected.has(key(entry.path))) {
        throw new UnsafePathError('Required media missing')
      }
    }
    for (const candidate of this.candidates.values()) {
      if (!selected.has(key(candidate.path))) {
        this.record({ path: candidate.path, kind: candidate.kind, status: 'RETAINED', reason: '用户选择保留' })
      }
    }
    let succeeded = true
    for (const candidate of this.candidates.values()) {
      if (selected.has(key(candidate.path)) && !(await this.remove(candidate))) succeeded = false
    }
    return succeeded
  }

  private async remove(candidate: Candidate): Promise<boolean> {
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
        reason: code === 'ENOENT' ? '文件原本不存在，本次未删除' : '文件删除未完成，作品记录保留供重试',
        code
      })
      return code === 'ENOENT'
    }
  }

  async cleanupDirectories() {
    if (!this.cleanupAllowed) return
    for (const directory of this.directories.sort((a, b) => b.split('/').length - a.split('/').length)) {
      try {
        await fs.rmdir(await this.safePath(directory))
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
}
