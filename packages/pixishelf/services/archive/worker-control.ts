import { ArchiveError, toArchiveError } from './errors'

/**
 * Peer cancellation is a consequence, not the cause, of a concurrent media
 * failure. Preserve the first recorded controller reason and otherwise prefer
 * a non-cancellation failure so quota/pause decisions are never hidden.
 */
export function selectPrimaryWorkerError(rootError: ArchiveError | null, rejectedReasons: unknown[]): ArchiveError | null {
  if (rootError) return rootError
  const classified = rejectedReasons.map(toArchiveError)
  return classified.find((error) => error.code !== 'CANCELLED') ?? classified[0] ?? null
}
