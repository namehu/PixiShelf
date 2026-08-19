import { discoverLocalWorkPages, type LocalWorkCandidate, type ScanDiscoveryLimits } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { normalizeRelativeScanPath, resolveSafeScanRoot } from './paths.ts'

export interface BoundedLocalWorkDiscoveryInput {
  scanRoot: string
  localDirectory: string
  limits: ScanDiscoveryLimits & { maxCandidates: number }
  signal: AbortSignal
}

export async function discoverBoundedLocalWorkCandidates(
  input: BoundedLocalWorkDiscoveryInput
): Promise<LocalWorkCandidate[]> {
  validatePositiveLimit('maxCandidates', input.limits.maxCandidates)
  const root = await resolveSafeScanRoot(input.scanRoot)
  const localDirectory = normalizeRelativeScanPath(input.localDirectory)
  const candidates: LocalWorkCandidate[] = []
  for await (const page of discoverLocalWorkPages(root, localDirectory, input.limits, input.signal)) {
    if (candidates.length + page.length > input.limits.maxCandidates) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local import candidate count exceeds the configured limit')
    }
    candidates.push(...page)
  }
  return candidates
}

function validatePositiveLimit(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ScanExecutorError('CONFIGURATION_INVALID', `${name} must be a positive integer`)
  }
}
