import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import { throwIfAborted } from './bounded.ts'
import { hashStableFile } from './content-reader.ts'
import { ScanExecutorError } from './errors.ts'
import { resolveSafeExistingPath, resolveSafeScanRoot, type SafeScanRoot } from './paths.ts'
import { compareCodePoints } from './stable-order.ts'

const mediaExtensions = new Set<string>(MEDIA_FILE_EXTENSIONS)
const videoExtensions = new Set<string>(VIDEO_FILE_EXTENSIONS)
const maxChapterManifestBytes = 5 * 1024 * 1024

export interface LocalWorkFingerprintInput {
  scanRoot: string
  relativeDirectory: string
  kind: 'MEDIA_DIRECTORY'
  maxEntries: number
  maxFiles: number
  maxFileBytes: number
  signal: AbortSignal
}

export async function computeLocalWorkContentFingerprint(input: LocalWorkFingerprintInput): Promise<string> {
  const root = await resolveSafeScanRoot(input.scanRoot)
  return computeLocalWorkContentFingerprintWithinRoot({ ...input, root })
}

export async function computeLocalWorkContentFingerprintWithinRoot(input: {
  root: SafeScanRoot
  relativeDirectory: string
  kind: 'MEDIA_DIRECTORY'
  maxEntries: number
  maxFiles: number
  maxFileBytes: number
  signal: AbortSignal
}): Promise<string> {
  validateLimits(input)
  const directory = await resolveSafeExistingPath(input.root, input.relativeDirectory, 'directory')
  const directoryFiles: Array<{ name: string; absolutePath: string }> = []
  let entries = 0
  const handle = await fs.opendir(directory.absolutePath)
  try {
    for await (const entry of handle) {
      throwIfAborted(input.signal)
      entries += 1
      if (entries > input.maxEntries) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work exceeds the configured entry limit')
      }
      const absolutePath = path.join(directory.absolutePath, entry.name)
      const metadata = await fs.lstat(absolutePath)
      if (metadata.isSymbolicLink()) {
        throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Local work contains a symbolic link')
      }
      if (!metadata.isFile()) continue
      directoryFiles.push({ name: entry.name, absolutePath })
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  const mediaFiles = directoryFiles.filter((file) => mediaExtensions.has(path.extname(file.name).toLowerCase()))
  if (mediaFiles.length > input.maxFiles) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work exceeds the configured file limit')
  }
  const files = [...mediaFiles, ...compatibleChapterManifestFiles(directoryFiles, mediaFiles)]
  files.sort((left, right) => compareCodePoints(left.name, right.name))
  const hashedFiles: Array<{ name: string; size: number; sha256: string }> = []
  for (const file of files) {
    const content = await hashStableFile({
      absolutePath: file.absolutePath,
      maxBytes: isChapterManifestName(file.name) ? Math.min(input.maxFileBytes, maxChapterManifestBytes) : input.maxFileBytes,
      signal: input.signal
    })
    hashedFiles.push({ name: file.name, size: content.size, sha256: content.sha256 })
  }
  return buildLocalWorkContentFingerprint(input.kind, hashedFiles)
}

function compatibleChapterManifestFiles(
  directoryFiles: Array<{ name: string; absolutePath: string }>,
  mediaFiles: Array<{ name: string; absolutePath: string }>
) {
  const compatibleNames = new Set(
    mediaFiles.flatMap((file) => {
      if (!videoExtensions.has(path.extname(file.name).toLowerCase())) return []
      const parsed = path.parse(file.name)
      return [`${parsed.name}.chapters.json`, `${parsed.base}.chapters.json`, `${parsed.name}..chapters.json`].map((name) =>
        name.toLowerCase()
      )
    })
  )
  const mediaNames = new Set(mediaFiles.map((file) => file.name))
  return directoryFiles.filter(
    (file) => !mediaNames.has(file.name) && compatibleNames.has(file.name.toLowerCase())
  )
}

function isChapterManifestName(name: string) {
  return name.toLowerCase().endsWith('.chapters.json')
}

export function buildLocalWorkContentFingerprint(
  kind: 'MEDIA_DIRECTORY',
  files: readonly { name: string; size: number; sha256: string }[]
) {
  const fingerprint = createHash('sha256')
  fingerprint.update(kind).update('\n')
  for (const file of [...files].sort((left, right) => compareCodePoints(left.name, right.name))) {
    fingerprint.update(file.name).update('\0').update(String(file.size)).update('\0').update(file.sha256).update('\n')
  }
  return fingerprint.digest('hex')
}

function validateLimits(input: { maxEntries: number; maxFiles: number; maxFileBytes: number }) {
  for (const [name, value] of [
    ['maxEntries', input.maxEntries],
    ['maxFiles', input.maxFiles],
    ['maxFileBytes', input.maxFileBytes]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ScanExecutorError('CONFIGURATION_INVALID', `${name} must be a positive integer`)
    }
  }
}
