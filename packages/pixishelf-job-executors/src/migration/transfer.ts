import path from 'node:path'
import {
  ensureSafeDirectory,
  resolvePathInsideRoot,
  resolveSafeExistingFile,
  resolveSafeOptionalFile
} from './paths.js'
import type { MigrationFilePlan, MigrationFileSystemPort, MigrationRuntimeConfig } from './types.js'
import { MigrationActionRequiredError, MigrationPermanentError } from './types.js'

export interface MigrationFingerprint {
  size: number
  mtimeMs: number
  sha256: string
}

export async function stageMigrationFile(input: {
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  file: MigrationFilePlan
}): Promise<MigrationFingerprint> {
  let sourcePath: string
  try {
    sourcePath = await resolveSafeExistingFile(input.fileSystem, input.config.scanRoot, input.file.sourceRelativePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
    if (input.file.sourceSha256) {
      throw new MigrationActionRequiredError(
        'FILESYSTEM_RECOVERY_FAILED',
        `Source disappeared after staging for image ${input.file.imageId}`,
        input.file.id
      )
    }
    throw new MigrationPermanentError('SOURCE_NOT_FOUND', `Source was not found for image ${input.file.imageId}`)
  }
  const fingerprint = await fingerprintFile(input.fileSystem, sourcePath)
  assertPersistedSourceMatches(input.file, fingerprint)

  const stagingDirectory = path.posix.dirname(input.file.stagedRelativePath)
  const stagingDirectoryPath = await ensureSafeDirectory(input.fileSystem, input.config.scanRoot, stagingDirectory)
  const stagedPath = resolvePathInsideRoot(input.config.scanRoot, input.file.stagedRelativePath)
  let existing = await resolveCheckpointFile(input, input.file.stagedRelativePath, 'staging')
  if (!existing) {
    try {
      await input.fileSystem.copyFileExclusive(sourcePath, stagedPath)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    existing = await resolveCheckpointFile(input, input.file.stagedRelativePath, 'staging')
  }
  if (!existing) throw new Error('Exclusive migration staging copy did not create a file')

  const stagedHash = await input.fileSystem.hashFile(existing)
  if (stagedHash !== fingerprint.sha256) {
    throw new MigrationActionRequiredError(
      'STAGING_CONFLICT',
      `Attempt staging content conflicts for image ${input.file.imageId}`,
      input.file.id
    )
  }
  await input.fileSystem.syncFile(existing)
  await input.fileSystem.syncDirectory(stagingDirectoryPath)
  return fingerprint
}

export async function publishMigrationFile(input: {
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  file: MigrationFilePlan
  expectedSha256: string
}): Promise<void> {
  const stagedPath = await resolveCheckpointFile(input, input.file.stagedRelativePath, 'staging')
  if (!stagedPath) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      'Migration staging file is missing',
      input.file.id
    )
  }
  const stagedHash = await input.fileSystem.hashFile(stagedPath)
  if (stagedHash !== input.expectedSha256) {
    throw new MigrationActionRequiredError(
      'STAGING_CONFLICT',
      `Staged content changed for image ${input.file.imageId}`,
      input.file.id
    )
  }
  await verifySourceBeforeDatabasePublish(input.fileSystem, input.config, input.file, input.expectedSha256)

  const targetDirectory = path.posix.dirname(input.file.targetRelativePath)
  const targetDirectoryPath = await ensureSafeDirectory(input.fileSystem, input.config.scanRoot, targetDirectory)
  const targetPath = resolvePathInsideRoot(input.config.scanRoot, input.file.targetRelativePath)
  let existing = await resolveCheckpointFile(input, input.file.targetRelativePath, 'target')
  if (!existing) {
    try {
      await input.fileSystem.copyFileExclusive(stagedPath, targetPath)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    existing = await resolveCheckpointFile(input, input.file.targetRelativePath, 'target')
  }
  if (!existing) throw new Error('Exclusive migration publication copy did not create a file')
  const targetHash = await input.fileSystem.hashFile(existing)
  if (targetHash !== input.expectedSha256) {
    throw new MigrationActionRequiredError(
      'TARGET_CONFLICT',
      `Canonical target already contains different content for image ${input.file.imageId}`,
      input.file.id
    )
  }
  await input.fileSystem.syncFile(existing)
  await input.fileSystem.syncDirectory(targetDirectoryPath)
}

export async function verifySourceBeforeDatabasePublish(
  fileSystem: MigrationFileSystemPort,
  config: MigrationRuntimeConfig,
  file: MigrationFilePlan,
  expectedSha256: string
): Promise<void> {
  if (file.sourceRelativePath === file.targetRelativePath) return
  const source = await resolveCheckpointFile({ fileSystem, config, file }, file.sourceRelativePath, 'source')
  if (!source) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Source disappeared before database publication for image ${file.imageId}`,
      file.id
    )
  }
  const current = await fingerprintFile(fileSystem, source)
  if (
    current.sha256 !== expectedSha256 ||
    (file.sourceSize !== null && current.size !== file.sourceSize) ||
    (file.sourceMtimeMs !== null && current.mtimeMs !== file.sourceMtimeMs)
  ) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Source changed after staging and before database publication for image ${file.imageId}`,
      file.id
    )
  }
}

/** Last filesystem fence before the DB path CAS. */
export async function verifyPreparedMigrationFile(input: {
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  file: MigrationFilePlan
  expected: MigrationFingerprint
}): Promise<void> {
  if (input.file.sourceRelativePath === input.file.targetRelativePath) return
  const source = await requireExactFile(input, input.file.sourceRelativePath, 'source', true)
  const staged = await requireExactFile(input, input.file.stagedRelativePath, 'staging', false)
  const target = await requireExactFile(input, input.file.targetRelativePath, 'target', false)
  if (samePhysicalFile(source, target)) {
    throw new MigrationActionRequiredError(
      'TARGET_CONFLICT',
      'Migration source and canonical target resolve to the same physical file',
      input.file.id
    )
  }
  if (staged.stat.identity === target.stat.identity) {
    throw new MigrationActionRequiredError(
      'STAGING_CONFLICT',
      'Migration staging and canonical target resolve to the same physical file',
      input.file.id
    )
  }
}

export async function cleanupPublishedSource(input: {
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  file: MigrationFilePlan
  expected: MigrationFingerprint
}): Promise<'REMOVED' | 'MISSING' | 'SAME_AS_TARGET'> {
  if (input.file.sourceRelativePath === input.file.targetRelativePath) return 'SAME_AS_TARGET'
  const target = await resolveCheckpointFile(input, input.file.targetRelativePath, 'target')
  if (!target) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      'Canonical target is missing during source cleanup',
      input.file.id
    )
  }
  const targetBefore = await input.fileSystem.lstat(target)
  const targetFingerprint = await fingerprintFile(input.fileSystem, target)
  if (targetFingerprint.size !== input.expected.size || targetFingerprint.sha256 !== input.expected.sha256) {
    throw new MigrationActionRequiredError(
      'TARGET_CONFLICT',
      'Canonical target content changed before source cleanup',
      input.file.id
    )
  }
  const source = await resolveCheckpointFile(input, input.file.sourceRelativePath, 'source')
  if (!source) return 'MISSING'
  const sourceBefore = await input.fileSystem.lstat(source)
  if (samePhysicalFile({ path: source, stat: sourceBefore }, { path: target, stat: targetBefore })) {
    throw new MigrationActionRequiredError(
      'TARGET_CONFLICT',
      'Migration source and canonical target resolve to the same physical file',
      input.file.id
    )
  }
  const current = await fingerprintFile(input.fileSystem, source)
  if (!fingerprintsEqual(current, input.expected)) {
    throw new MigrationActionRequiredError(
      'SOURCE_CHANGED_AFTER_PUBLISH',
      `Published image ${input.file.imageId} has a changed source; refusing deletion`,
      input.file.id
    )
  }
  // Re-read metadata after hashing so ordinary replacement races are detected before unlink.
  const finalStat = await input.fileSystem.lstat(source)
  if (
    finalStat.isSymbolicLink ||
    !finalStat.isFile ||
    finalStat.identity !== sourceBefore.identity ||
    finalStat.size !== input.expected.size ||
    Math.trunc(finalStat.mtimeMs) !== input.expected.mtimeMs
  ) {
    throw new MigrationActionRequiredError(
      'SOURCE_CHANGED_AFTER_PUBLISH',
      `Published image ${input.file.imageId} source changed during cleanup`,
      input.file.id
    )
  }
  const finalTargetStat = await input.fileSystem.lstat(target)
  if (
    finalTargetStat.isSymbolicLink ||
    !finalTargetStat.isFile ||
    finalTargetStat.identity !== targetBefore.identity ||
    finalTargetStat.size !== input.expected.size
  ) {
    throw new MigrationActionRequiredError(
      'TARGET_CONFLICT',
      'Canonical target changed during source cleanup',
      input.file.id
    )
  }
  const [finalSourceHash, finalTargetHash] = await Promise.all([
    input.fileSystem.hashFile(source),
    input.fileSystem.hashFile(target)
  ])
  if (finalSourceHash !== input.expected.sha256 || finalTargetHash !== input.expected.sha256) {
    throw new MigrationActionRequiredError(
      'SOURCE_CHANGED_AFTER_PUBLISH',
      'Migration source or target changed immediately before source cleanup',
      input.file.id
    )
  }
  await input.fileSystem.unlink(source)
  await input.fileSystem.syncDirectory(path.dirname(source))
  return 'REMOVED'
}

async function requireExactFile(
  input: {
    fileSystem: MigrationFileSystemPort
    config: MigrationRuntimeConfig
    file: MigrationFilePlan
    expected: MigrationFingerprint
  },
  relativePath: string,
  label: 'source' | 'staging' | 'target',
  compareMtime: boolean
) {
  const filePath = await resolveCheckpointFile(input, relativePath, label)
  if (!filePath) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Prepared migration ${label} is missing`,
      input.file.id
    )
  }
  const stat = await input.fileSystem.lstat(filePath)
  const fingerprint = await fingerprintFile(input.fileSystem, filePath)
  if (
    fingerprint.size !== input.expected.size ||
    fingerprint.sha256 !== input.expected.sha256 ||
    (compareMtime && fingerprint.mtimeMs !== input.expected.mtimeMs)
  ) {
    throw new MigrationActionRequiredError(
      label === 'staging' ? 'STAGING_CONFLICT' : label === 'target' ? 'TARGET_CONFLICT' : 'FILESYSTEM_RECOVERY_FAILED',
      `Prepared migration ${label} no longer matches its checkpoint`,
      input.file.id
    )
  }
  return { path: filePath, stat }
}

async function resolveCheckpointFile(
  input: { fileSystem: MigrationFileSystemPort; config: MigrationRuntimeConfig; file: MigrationFilePlan },
  relativePath: string,
  label: string
) {
  try {
    return await resolveSafeOptionalFile(input.fileSystem, input.config.scanRoot, relativePath)
  } catch (error) {
    if (error instanceof MigrationPermanentError) {
      throw new MigrationActionRequiredError(
        'FILESYSTEM_RECOVERY_FAILED',
        `Checkpointed migration ${label} path is no longer safe`,
        input.file.id
      )
    }
    throw error
  }
}

function samePhysicalFile(
  left: { path: string; stat: { identity: string } },
  right: { path: string; stat: { identity: string } }
) {
  return (
    left.stat.identity === right.stat.identity ||
    path.resolve(left.path).toLocaleLowerCase('en-US') === path.resolve(right.path).toLocaleLowerCase('en-US')
  )
}

export async function removeAttemptStaging(input: {
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  file: MigrationFilePlan
}): Promise<void> {
  const staged = await resolveCheckpointFile(input, input.file.stagedRelativePath, 'staging')
  if (!staged) return
  await input.fileSystem.unlink(staged)
  await input.fileSystem.syncDirectory(path.dirname(staged))
}

async function fingerprintFile(fileSystem: MigrationFileSystemPort, filePath: string): Promise<MigrationFingerprint> {
  const stat = await fileSystem.lstat(filePath)
  if (stat.isSymbolicLink || !stat.isFile) {
    throw new MigrationPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Migration file must be regular and non-symlink')
  }
  return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), sha256: await fileSystem.hashFile(filePath) }
}

function assertPersistedSourceMatches(file: MigrationFilePlan, current: MigrationFingerprint) {
  if (
    (file.sourceSize !== null && file.sourceSize !== current.size) ||
    (file.sourceMtimeMs !== null && file.sourceMtimeMs !== current.mtimeMs) ||
    (file.sourceSha256 !== null && file.sourceSha256 !== current.sha256)
  ) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Persisted source fingerprint changed for image ${file.imageId}`,
      file.id
    )
  }
}

function fingerprintsEqual(left: MigrationFingerprint, right: MigrationFingerprint) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.sha256 === right.sha256
}

function isAlreadyExists(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}
