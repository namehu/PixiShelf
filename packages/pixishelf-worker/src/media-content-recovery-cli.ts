import * as fs from 'node:fs/promises'
import path from 'node:path'

export class MediaRecoveryCliError extends Error {}

export type MediaRecoveryCommand =
  | { command: 'inspect'; jobId: string; sessionId: string; output: string }
  | {
      command: 'grant'
      snapshotFile: string
      expectedDigest: string
      backupCheckpointRef: string
      operator: string
      confirmAllWritersStopped: true
    }
  | { command: 'resume'; grantId: string; operator: string; confirmAllWritersStopped: true }
  | { command: 'revoke'; grantId: string; operator: string; reason: string }

export interface RecoveryInspection {
  snapshot: unknown
  digest: string
}
export interface MediaRecoveryCliPort {
  inspect(jobId: string, sessionId: string): Promise<RecoveryInspection>
  grant(input: {
    snapshot: unknown
    expectedDigest: string
    backupCheckpointRef: string
    operator: string
    confirmAllWritersStopped: true
  }): Promise<unknown>
  resume(input: { grantId: string; operator: string; confirmAllWritersStopped: true }): Promise<unknown>
  revoke(input: { grantId: string; operator: string; reason: string }): Promise<unknown>
}

const MAX_SNAPSHOT_BYTES = 1024 * 1024
const FORMAT = 'pixishelf-media-content-recovery-v1'
const USAGE =
  'Usage: media-content-recovery inspect --job <id> --session <id> --output <absolute-file> | grant --snapshot <absolute-file> --expect <sha256> --backup-checkpoint <ref> --operator <name> --confirm-all-writers-stopped | resume --grant <id> --operator <name> --confirm-all-writers-stopped | revoke --grant <id> --operator <name> --reason <text>'

export function parseMediaRecoveryCommand(args: readonly string[]): MediaRecoveryCommand {
  const command = args[0]
  if (!['inspect', 'grant', 'resume', 'revoke'].includes(command ?? '')) throw new MediaRecoveryCliError(USAGE)
  const allowed =
    command === 'inspect'
      ? ['--job', '--session', '--output']
      : command === 'grant'
        ? ['--snapshot', '--expect', '--backup-checkpoint', '--operator', '--confirm-all-writers-stopped']
        : command === 'resume'
          ? ['--grant', '--operator', '--confirm-all-writers-stopped']
          : ['--grant', '--operator', '--reason']
  const options = new Map<string, string>()
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!
    if (!allowed.includes(key) || options.has(key))
      throw new MediaRecoveryCliError('Unknown or duplicate recovery option')
    if (key === '--confirm-all-writers-stopped') {
      options.set(key, 'true')
      continue
    }
    const value = args[++i]
    if (!value || value.startsWith('--') || !value.trim() || value.length > 1024 || value.includes('\0'))
      throw new MediaRecoveryCliError('Missing or invalid recovery option')
    options.set(key, value.trim())
  }
  if (options.size !== allowed.length) throw new MediaRecoveryCliError(USAGE)
  const value = (key: string) => options.get(key)!
  const absolute = (key: string) => {
    const name = value(key)
    if (!path.isAbsolute(name)) throw new MediaRecoveryCliError('Recovery snapshot requires an absolute file path')
    return name
  }
  if (command === 'inspect')
    return { command, jobId: value('--job'), sessionId: value('--session'), output: absolute('--output') }
  if (command === 'resume')
    return { command, grantId: value('--grant'), operator: value('--operator'), confirmAllWritersStopped: true }
  if (command === 'revoke')
    return { command, grantId: value('--grant'), operator: value('--operator'), reason: value('--reason') }
  if (!/^[a-f0-9]{64}$/.test(value('--expect')))
    throw new MediaRecoveryCliError('Expected recovery digest must be lowercase SHA-256')
  return {
    command: 'grant',
    snapshotFile: absolute('--snapshot'),
    expectedDigest: value('--expect'),
    backupCheckpointRef: value('--backup-checkpoint'),
    operator: value('--operator'),
    confirmAllWritersStopped: true
  }
}

export async function executeMediaRecoveryCommand(
  command: MediaRecoveryCommand,
  port: MediaRecoveryCliPort
): Promise<unknown> {
  if (command.command === 'resume') return port.resume(command)
  if (command.command === 'revoke') return port.revoke(command)
  if (command.command === 'inspect') {
    const inspected = await port.inspect(command.jobId, command.sessionId)
    const encoded = JSON.stringify({ format: FORMAT, ...inspected }, null, 2) + '\n'
    if (Buffer.byteLength(encoded) > MAX_SNAPSHOT_BYTES)
      throw new MediaRecoveryCliError('Recovery inspection exceeds the bounded snapshot size')
    // Exclusive creation preserves the operator's earlier checkpoint, even when this command is repeated.
    const file = await fs.open(command.output, 'wx', 0o600)
    try {
      await file.writeFile(encoded)
      await file.sync()
    } finally {
      await file.close()
    }
    return { command: 'inspect', output: command.output, digest: inspected.digest }
  }
  const file = await fs.open(command.snapshotFile, 'r')
  let data: unknown
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_SNAPSHOT_BYTES)
      throw new MediaRecoveryCliError('Recovery snapshot must be a bounded regular file')
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await file.stat()
    if (
      length !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new MediaRecoveryCliError('Recovery snapshot changed while reading')
    data = JSON.parse(buffer.subarray(0, length).toString('utf8')) as unknown
  } finally {
    await file.close()
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('format' in data) ||
    data.format !== FORMAT ||
    !('digest' in data) ||
    data.digest !== command.expectedDigest ||
    !('snapshot' in data)
  )
    throw new MediaRecoveryCliError('Recovery snapshot or expected digest does not match')
  return port.grant({
    snapshot: data.snapshot,
    expectedDigest: command.expectedDigest,
    backupCheckpointRef: command.backupCheckpointRef,
    operator: command.operator,
    confirmAllWritersStopped: command.confirmAllWritersStopped
  })
}
