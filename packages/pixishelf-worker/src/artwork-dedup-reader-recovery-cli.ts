export class ArtworkDedupReaderRecoveryCliError extends Error {}
export type ArtworkDedupReaderRecoveryCommand =
  | { command: 'inspect'; runId: string }
  | {
      command: 'recover'
      runId: string
      expectedDigest: string
      expectedReaderToken: string
      operator: string
      confirmAllWritersStopped: true
    }
export function parseArtworkDedupReaderRecoveryCommand(args: readonly string[]): ArtworkDedupReaderRecoveryCommand {
  const command = args[0]
  if (command !== 'inspect' && command !== 'recover') {
    throw new ArtworkDedupReaderRecoveryCliError(
      'Use inspect --run <id>, or recover --run <id> --expect <digest> --expected-reader-token <token> --operator <name> --confirm-all-writers-stopped'
    )
  }
  const allowed =
    command === 'inspect'
      ? ['--run']
      : ['--run', '--expect', '--expected-reader-token', '--operator', '--confirm-all-writers-stopped']
  const options = new Map<string, string>()
  for (let n = 1; n < args.length; n++) {
    const key = args[n]!
    if (!allowed.includes(key) || options.has(key)) {
      throw new ArtworkDedupReaderRecoveryCliError('Unknown or duplicate option')
    }
    if (key === '--confirm-all-writers-stopped') {
      options.set(key, 'true')
      continue
    }
    const value = args[++n]
    if (!value?.trim() || value.startsWith('--') || value.length > 128 || value.includes('\0')) {
      throw new ArtworkDedupReaderRecoveryCliError('Missing or invalid option')
    }
    options.set(key, value.trim())
  }
  if (options.size !== allowed.length) {
    throw new ArtworkDedupReaderRecoveryCliError('All recovery options and stopped-writers confirmation are required')
  }
  const runId = options.get('--run')!
  if (command === 'inspect') return { command, runId }
  const expectedDigest = options.get('--expect')!
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new ArtworkDedupReaderRecoveryCliError('Invalid inspection digest')
  return {
    command,
    runId,
    expectedDigest,
    expectedReaderToken: options.get('--expected-reader-token')!,
    operator: options.get('--operator')!,
    confirmAllWritersStopped: true
  }
}
