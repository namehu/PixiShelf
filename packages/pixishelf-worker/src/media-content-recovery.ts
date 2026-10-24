import {
  createDatabaseClient,
  inspectMediaContentRecovery,
  grantMediaContentRecovery,
  revokeMediaContentRecovery,
  resumeGrantedMediaContentRecovery,
  parseMediaContentRecoverySnapshot,
  type MediaContentRecoverySnapshot,
  type MediaContentResult
} from '@pixishelf/db'
import { readExecutorMediaRecoveryDomainSnapshot, resolveMediaContentRoots } from '@pixishelf/job-executors'
import {
  executeMediaRecoveryCommand,
  parseMediaRecoveryCommand,
  MediaRecoveryCliError,
  type MediaRecoveryCliPort
} from './media-content-recovery-cli.ts'

function ready<T>(result: MediaContentResult<T>): T {
  if (result.status !== 'READY')
    throw new MediaRecoveryCliError(
      `Recovery refused (${result.status}); preserve the original files and inspect again`
    )
  return result.value
}

export async function runMediaContentRecovery(args: string[], environment = process.env): Promise<number> {
  const command = parseMediaRecoveryCommand(args)
  const database = createDatabaseClient()
  try {
    const verifyRoots = async (snapshot: MediaContentRecoverySnapshot) => {
      const sourceRoot = environment.SOURCE_MEDIA_ROOT ?? environment.SCAN_PATH
      if (!sourceRoot?.trim()) throw new MediaRecoveryCliError('SOURCE_MEDIA_ROOT or SCAN_PATH is required')
      const inventory = await database.pixivMetadataInventoryState.findUnique({
        where: { id: 'pixiv' },
        select: { rootIdentity: true }
      })
      const roots = await resolveMediaContentRoots({
        sourceRoot,
        archiveRoot: environment.ARCHIVE_ROOT ?? environment.ARCHIVE_STORAGE_PATH ?? sourceRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      })
      for (const claim of snapshot.claims) {
        const root = claim.directory.logicalRoot === roots.source.logicalRoot ? roots.source : roots.archive
        if (root.logicalRoot !== claim.directory.logicalRoot || root.rootIdentity !== claim.directory.rootIdentity)
          throw new MediaRecoveryCliError(
            'Media root differs from the original declaration; no recovery grant was issued'
          )
      }
    }
    const port: MediaRecoveryCliPort = {
      inspect: async (jobId, sessionId) => {
        const inspected = await database.$transaction(async (tx) =>
          ready(
            await inspectMediaContentRecovery(tx, {
              jobId,
              sessionId,
              now: new Date(),
              readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
            })
          )
        )
        await verifyRoots(inspected.snapshot)
        return inspected
      },
      grant: async (input) => {
        const snapshot = parseMediaContentRecoverySnapshot(input.snapshot)
        await verifyRoots(snapshot)
        return database.$transaction(async (tx) =>
          ready(
            await grantMediaContentRecovery(tx, {
              ...input,
              snapshot,
              now: new Date(),
              readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
            })
          )
        )
      },
      resume: async (input) => {
        const grant = await database.mediaContentRecoveryGrant.findUnique({
          where: { id: input.grantId },
          select: { snapshot: true }
        })
        if (!grant) throw new MediaRecoveryCliError('Recovery grant was not found')
        await verifyRoots(parseMediaContentRecoverySnapshot(grant.snapshot))
        return database.$transaction(async (tx) =>
          ready(
            await resumeGrantedMediaContentRecovery(tx, {
              ...input,
              now: new Date(),
              readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
            })
          )
        )
      },
      revoke: async (input) =>
        database.$transaction(async (tx) =>
          ready(
            await revokeMediaContentRecovery(tx, {
              ...input,
              now: new Date()
            })
          )
        )
    }
    const result = await executeMediaRecoveryCommand(command, port)
    process.stdout.write(JSON.stringify(result) + '\n')
    return 0
  } finally {
    await database.$disconnect()
  }
}

if (require.main === module) {
  void runMediaContentRecovery(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(
        (error instanceof MediaRecoveryCliError
          ? error.message
          : 'Media recovery failed; verify the inspection, stopped writers, database migrations and configured roots') +
          '\n'
      )
      process.exitCode = 1
    })
}
