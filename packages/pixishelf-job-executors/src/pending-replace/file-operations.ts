import path from 'node:path'
import type {
  PendingReplaceExecutorDependencies,
  PendingReplaceManifestFile,
  PendingReplaceMediaSnapshot,
  PendingReplaceTargetFileSnapshot
} from './types.ts'
import type { QueueSqlExecutor } from '@pixishelf/job-runtime'
import { resolveSafeCreatablePath, resolveSafeExistingPath } from './paths.ts'
import { PendingReplaceActionRequiredError, PendingReplacePermanentError } from './types.ts'

export async function assertSnapshotFiles<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  baseRelative: string,
  snapshots: ReadonlyArray<{ name: string; size: number; sha256: string }>,
  changedCode: 'SOURCE_CHANGED' | 'TARGET_CHANGED' | 'BACKUP_CHANGED'
): Promise<void> {
  for (const snapshot of snapshots) {
    const relative = path.posix.join(baseRelative, snapshot.name)
    let absolute: string
    try {
      absolute = await resolveSafeExistingPath(dependencies.fileSystem, dependencies.config.scanRoot, relative, 'file')
    } catch (error) {
      throwChanged(changedCode, 'Expected checkpoint file is missing', error)
    }
    const stat = await dependencies.fileSystem.lstat(absolute)
    if (stat.size !== snapshot.size || (await dependencies.fileSystem.hashFile(absolute)) !== snapshot.sha256) {
      throwChanged(changedCode, 'Checkpoint file fingerprint changed')
    }
  }
}

export async function moveCheckpointFile<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  sourceRelative: string,
  targetRelative: string,
  fingerprint: { size: number; sha256: string },
  changedCode: 'SOURCE_CHANGED' | 'TARGET_CHANGED' | 'BACKUP_CHANGED'
): Promise<void> {
  const source = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, sourceRelative)
  const target = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, targetRelative)
  const sourceState = await fingerprintIfExists(dependencies, source)
  const targetState = await fingerprintIfExists(dependencies, target)
  const matches = (value: { size: number; sha256: string } | null) =>
    value?.size === fingerprint.size && value.sha256 === fingerprint.sha256
  if (sourceState && targetState) {
    throw new PendingReplaceActionRequiredError('FILESYSTEM_RECOVERY_FAILED', 'Both checkpoint source and target exist')
  }
  if (targetState) {
    if (!matches(targetState)) throwChanged(changedCode, 'Checkpoint target fingerprint changed')
    return
  }
  if (!sourceState || !matches(sourceState)) throwChanged(changedCode, 'Checkpoint source fingerprint changed')
  await dependencies.fileSystem.mkdir(path.dirname(target))
  await dependencies.fileSystem.rename(source, target)
  const moved = await fingerprintIfExists(dependencies, target)
  if (!matches(moved))
    throw new PendingReplaceActionRequiredError('FILESYSTEM_RECOVERY_FAILED', 'Rename result is not durable')
}

export async function moveDirectoryIdempotent<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  sourceRelative: string,
  targetRelative: string
): Promise<void> {
  const source = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, sourceRelative)
  const target = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, targetRelative)
  const sourceExists = await directoryExists(dependencies, source)
  const targetExists = await directoryExists(dependencies, target)
  if (sourceExists && targetExists) {
    throw new PendingReplaceActionRequiredError('FILESYSTEM_RECOVERY_FAILED', 'Both checkpoint directories exist')
  }
  if (targetExists) return
  if (!sourceExists) throw new PendingReplacePermanentError('SOURCE_CHANGED', 'Checkpoint directory is missing')
  await dependencies.fileSystem.mkdir(path.dirname(target))
  await dependencies.fileSystem.rename(source, target)
}

export async function verifyManifestAcrossWorkspaces<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  sourceRelative: string,
  normalizedRelative: string,
  manifest: readonly PendingReplaceManifestFile[]
): Promise<void> {
  for (const file of manifest) {
    const installedName = file.kind === 'ignored' ? file.name : file.targetName
    if (!installedName) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Manifest target name is missing')
    const base = file.kind === 'ignored' ? sourceRelative : normalizedRelative
    await assertSnapshotFiles(
      dependencies,
      base,
      [{ name: installedName, size: file.size, sha256: file.sha256 }],
      'SOURCE_CHANGED'
    )
  }
}

export function installedSnapshots(media: readonly PendingReplaceMediaSnapshot[]): PendingReplaceTargetFileSnapshot[] {
  return media.map((entry) => ({
    name: entry.targetName,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    sha256: entry.sha256
  }))
}

export async function removeExactSnapshotFiles<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  baseRelative: string,
  snapshots: ReadonlyArray<{ name: string; size: number; sha256: string }>,
  options: { allowAlreadyRemoved?: boolean } = {}
): Promise<void> {
  const directory = await assertExactSnapshotDirectory(dependencies, baseRelative, snapshots, options)
  if (!directory) return
  for (const snapshot of snapshots) {
    let absolute: string
    try {
      absolute = await resolveSafeExistingPath(
        dependencies.fileSystem,
        dependencies.config.scanRoot,
        path.posix.join(baseRelative, snapshot.name),
        'file'
      )
    } catch (error) {
      if (options.allowAlreadyRemoved && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await dependencies.fileSystem.unlink(absolute)
  }
  await dependencies.fileSystem.removeDirectoryIfEmpty(directory)
}

export async function assertExactSnapshotDirectory<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  baseRelative: string,
  snapshots: ReadonlyArray<{ name: string; size: number; sha256: string }>,
  options: { allowAlreadyRemoved?: boolean } = {}
): Promise<string | null> {
  const directory = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, baseRelative)
  let listed: Awaited<ReturnType<PendingReplaceExecutorDependencies['fileSystem']['listDirectoryBounded']>>
  try {
    listed = await dependencies.fileSystem.listDirectoryBounded(directory, maximumDirectoryEntries(dependencies))
  } catch (error) {
    if (options.allowAlreadyRemoved && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new PendingReplaceActionRequiredError('BACKUP_CHANGED', 'Backup checkpoint directory is missing')
  }
  if (listed.hasMore) {
    throw new PendingReplaceActionRequiredError('BACKUP_CHANGED', 'Backup checkpoint exceeds the entry limit')
  }
  const expected = new Map(snapshots.map((snapshot) => [snapshot.name, snapshot]))
  for (const entry of listed.entries) {
    const snapshot = expected.get(entry.name)
    if (!snapshot || !entry.isFile || entry.isSymbolicLink) {
      throw new PendingReplaceActionRequiredError('BACKUP_CHANGED', 'Backup checkpoint contains an unexpected entry')
    }
    await assertSnapshotFiles(dependencies, baseRelative, [snapshot], 'BACKUP_CHANGED')
  }
  if (!options.allowAlreadyRemoved && listed.entries.length !== snapshots.length) {
    throw new PendingReplaceActionRequiredError('BACKUP_CHANGED', 'Backup checkpoint file is missing')
  }
  return directory
}

function maximumDirectoryEntries<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  return dependencies.config.maximumDirectoryEntries ?? 1_234
}

async function fingerprintIfExists<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  absolute: string
) {
  try {
    const stat = await dependencies.fileSystem.lstat(absolute)
    if (!stat.isFile || stat.isSymbolicLink) {
      throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Checkpoint path is not a regular file')
    }
    return { size: stat.size, sha256: await dependencies.fileSystem.hashFile(absolute) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function directoryExists<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  absolute: string
) {
  try {
    const stat = await dependencies.fileSystem.lstat(absolute)
    if (!stat.isDirectory || stat.isSymbolicLink) {
      throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Checkpoint path is not a regular directory')
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function throwChanged(
  code: 'SOURCE_CHANGED' | 'TARGET_CHANGED' | 'BACKUP_CHANGED',
  message: string,
  cause?: unknown
): never {
  if (code === 'BACKUP_CHANGED') throw new PendingReplaceActionRequiredError('BACKUP_CHANGED', message)
  void cause
  throw new PendingReplacePermanentError(code, message)
}
