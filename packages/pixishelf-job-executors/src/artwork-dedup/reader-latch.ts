import {
  getArtworkDedupAnyReaderLatch,
  releaseArtworkDedupReader,
  releaseArtworkDedupOperationReader,
  type PrismaClient
} from '@pixishelf/db'
import { DedupReaderError, type DedupReaderOptions } from './reader.ts'
import { isReaderOwner, proveReaderExited } from './reader-owner.ts'

/** The identity-only probe cannot accept media work; lease expiry alone never clears a reader. */
export async function releaseExitedDedupReader(database: PrismaClient, options: DedupReaderOptions) {
  const orphan = await database.$transaction((tx) => getArtworkDedupAnyReaderLatch(tx))
  if (!orphan) return
  if (
    !orphan.jobId ||
    !orphan.readerToken ||
    !isReaderOwner(orphan.readerOwner) ||
    !(await proveReaderExited(options, orphan.readerOwner))
  )
    throw new DedupReaderError('READER_CLOSE_FAILED')
  const identity = { jobId: orphan.jobId, executionVersion: orphan.executionVersion }
  await database.$transaction((tx) =>
    orphan.kind === 'SCAN'
      ? releaseArtworkDedupReader(tx, {
          execution: { ...identity, runId: orphan.id },
          readerToken: orphan.readerToken!
        })
      : releaseArtworkDedupOperationReader(tx, {
          execution: { ...identity, operationId: orphan.id },
          readerToken: orphan.readerToken!
        })
  )
}
