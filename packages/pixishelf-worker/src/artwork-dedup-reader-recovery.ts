import {
  createDatabaseClient,
  inspectArtworkDedupReaderRecovery,
  recoverArtworkDedupReader,
  inspectArtworkDedupOperationReaderRecovery,
  recoverArtworkDedupOperationReader
} from '@pixishelf/db'
import {
  parseArtworkDedupReaderRecoveryCommand,
  ArtworkDedupReaderRecoveryCliError
} from './artwork-dedup-reader-recovery-cli.ts'

export async function runArtworkDedupReaderRecovery(args: string[]): Promise<number> {
  const command = parseArtworkDedupReaderRecoveryCommand(args)
  const database = createDatabaseClient()
  try {
    const result = await database.$transaction<unknown>(async (tx) => {
      const now = new Date()
      if ('operationId' in command)
        return command.command === 'inspect'
          ? inspectArtworkDedupOperationReaderRecovery(tx, { operationId: command.operationId, now })
          : recoverArtworkDedupOperationReader(tx, { ...command, now })
      return command.command === 'inspect'
        ? inspectArtworkDedupReaderRecovery(tx, { runId: command.runId, now })
        : recoverArtworkDedupReader(tx, { ...command, now })
    })
    process.stdout.write(JSON.stringify(result) + '\n')
    return 0
  } finally {
    await database.$disconnect()
  }
}
if (require.main === module) {
  void runArtworkDedupReaderRecovery(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(
        (error instanceof ArtworkDedupReaderRecoveryCliError
          ? error.message
          : 'Reader recovery refused; stop all writers and inspect the exact retained reader again') + '\n'
      )
      process.exitCode = 1
    })
}
