import { createHash } from 'node:crypto'
import path from 'node:path'
import type { MigrationFileStat, MigrationFileSystemPort } from '../types.js'

interface Entry {
  kind: 'file' | 'directory' | 'symlink'
  content?: string
  mtimeMs: number
  realTarget?: string
  identity: string
}

export class MemoryMigrationFileSystem implements MigrationFileSystemPort {
  readonly entries = new Map<string, Entry>()
  readonly operations: string[] = []
  copyCount = 0
  private nextIdentity = 1

  addDirectory(directoryPath: string) {
    this.entries.set(this.key(directoryPath), { kind: 'directory', mtimeMs: 1, identity: this.identity() })
  }

  addFile(filePath: string, content: string, mtimeMs = 1) {
    this.entries.set(this.key(filePath), { kind: 'file', content, mtimeMs, identity: this.identity() })
  }

  addSymlink(linkPath: string, realTarget: string) {
    this.entries.set(this.key(linkPath), {
      kind: 'symlink',
      mtimeMs: 1,
      realTarget: this.key(realTarget),
      identity: this.identity()
    })
  }

  addHardlink(linkPath: string, existingPath: string) {
    const existing = this.required(existingPath)
    if (existing.kind !== 'file') throw fileError('EINVAL', existingPath)
    this.entries.set(this.key(linkPath), { ...existing })
  }

  has(filePath: string) {
    return this.entries.has(this.key(filePath))
  }

  async lstat(filePath: string): Promise<MigrationFileStat> {
    const entry = this.required(filePath)
    return {
      size: entry.content?.length ?? 0,
      mtimeMs: entry.mtimeMs,
      isFile: entry.kind === 'file',
      isDirectory: entry.kind === 'directory',
      isSymbolicLink: entry.kind === 'symlink',
      identity: entry.identity
    }
  }

  async realpath(filePath: string): Promise<string> {
    const entry = this.required(filePath)
    return entry.kind === 'symlink' ? entry.realTarget! : this.key(filePath)
  }

  async listDirectoryBounded(directoryPath: string, limit: number) {
    const directory = this.key(directoryPath)
    const entry = this.required(directory)
    if (entry.kind !== 'directory') throw fileError('ENOTDIR', directory)
    const prefix = `${directory}${path.sep}`
    const names = [...this.entries.keys()]
      .filter((candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes(path.sep))
      .map((candidate) => path.basename(candidate))
      .sort()
    return { names: names.slice(0, limit), hasMore: names.length > limit }
  }

  async mkdir(directoryPath: string): Promise<void> {
    const key = this.key(directoryPath)
    if (this.entries.has(key)) throw fileError('EEXIST', key)
    const parent = this.entries.get(path.dirname(key))
    if (!parent || parent.kind !== 'directory') throw fileError('ENOENT', key)
    this.entries.set(key, { kind: 'directory', mtimeMs: 1, identity: this.identity() })
    this.operations.push(`mkdir:${key}`)
  }

  async copyFileExclusive(sourcePath: string, targetPath: string): Promise<void> {
    const source = this.required(sourcePath)
    if (source.kind !== 'file') throw fileError('EINVAL', sourcePath)
    const target = this.key(targetPath)
    if (this.entries.has(target)) throw fileError('EEXIST', target)
    this.entries.set(target, { ...source, identity: this.identity() })
    this.copyCount += 1
    this.operations.push(`copy:${this.key(sourcePath)}->${target}`)
  }

  async hashFile(filePath: string): Promise<string> {
    const entry = this.required(filePath)
    if (entry.kind !== 'file') throw fileError('EINVAL', filePath)
    return createHash('sha256')
      .update(entry.content ?? '')
      .digest('hex')
  }

  async syncFile(filePath: string): Promise<void> {
    this.required(filePath)
    this.operations.push(`fsync-file:${this.key(filePath)}`)
  }

  async syncDirectory(directoryPath: string): Promise<void> {
    const entry = this.required(directoryPath)
    if (entry.kind !== 'directory') throw fileError('ENOTDIR', directoryPath)
    this.operations.push(`fsync-dir:${this.key(directoryPath)}`)
  }

  async unlink(filePath: string): Promise<void> {
    const key = this.key(filePath)
    const entry = this.required(key)
    if (entry.kind !== 'file') throw fileError('EISDIR', key)
    this.entries.delete(key)
    this.operations.push(`unlink:${key}`)
  }

  private required(filePath: string): Entry {
    const key = this.key(filePath)
    const entry = this.entries.get(key)
    if (!entry) throw fileError('ENOENT', key)
    return entry
  }

  private key(value: string) {
    return path.resolve(value)
  }

  private identity() {
    return `memory:${this.nextIdentity++}`
  }
}

function fileError(code: string, filePath: string) {
  return Object.assign(new Error(`${code}: ${filePath}`), { code })
}
