import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeMediaRecoveryCommand,
  parseMediaRecoveryCommand,
  type MediaRecoveryCliPort
} from '../media-content-recovery-cli.ts'

const dirs: string[] = []
const digest = 'a'.repeat(64)
const snapshot = { jobId: 'job-1', sessionId: 'maintenance:job-1' }
async function temporary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-recovery-cli-'))
  dirs.push(dir)
  return path.join(dir, 'inspection.json')
}
function port(): MediaRecoveryCliPort {
  return {
    inspect: vi.fn(async () => ({ snapshot, digest })),
    grant: vi.fn(async () => ({ grantId: 'grant-1' })),
    resume: vi.fn(async () => ({ jobId: 'job-1', status: 'PENDING' })),
    revoke: vi.fn(async () => ({ status: 'REVOKED' }))
  }
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('offline media recovery CLI', () => {
  it('requires an explicit stop confirmation and exact digest for mutations', () => {
    const args = [
      'grant',
      '--snapshot',
      '/tmp/plan.json',
      '--expect',
      digest,
      '--backup-checkpoint',
      'backup-1',
      '--operator',
      'operator-1'
    ]
    expect(() => parseMediaRecoveryCommand(args)).toThrow()
    expect(parseMediaRecoveryCommand([...args, '--confirm-all-writers-stopped']).command).toBe('grant')
    expect(() => parseMediaRecoveryCommand([...args, '--expect', digest, '--confirm-all-writers-stopped'])).toThrow()
    expect(() =>
      parseMediaRecoveryCommand(['inspect', '--job', 'j', '--session', 's', '--output', 'relative.json'])
    ).toThrow()
    expect(() =>
      parseMediaRecoveryCommand(['revoke', '--grant', 'g', '--operator', 'o', '--reason', 'changed', '--force'])
    ).toThrow()
  })

  it('writes a private inspection without overwriting an earlier checkpoint or granting anything', async () => {
    const output = await temporary()
    const gateway = port()
    const command = parseMediaRecoveryCommand([
      'inspect',
      '--job',
      'job-1',
      '--session',
      'maintenance:job-1',
      '--output',
      output
    ])
    await expect(executeMediaRecoveryCommand(command, gateway)).resolves.toMatchObject({ digest, output })
    expect((await fs.stat(output)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toMatchObject({ snapshot, digest })
    await expect(executeMediaRecoveryCommand(command, gateway)).rejects.toThrow()
    expect(gateway.grant).not.toHaveBeenCalled()
    expect(gateway.revoke).not.toHaveBeenCalled()
  })

  it('passes the exact inspected snapshot for server-side CAS and rejects a mismatched document', async () => {
    const output = await temporary()
    const gateway = port()
    await executeMediaRecoveryCommand(
      { command: 'inspect', jobId: 'job-1', sessionId: 'maintenance:job-1', output },
      gateway
    )
    const command = parseMediaRecoveryCommand([
      'grant',
      '--snapshot',
      output,
      '--expect',
      digest,
      '--backup-checkpoint',
      'backup-1',
      '--operator',
      'operator-1',
      '--confirm-all-writers-stopped'
    ])
    await executeMediaRecoveryCommand(command, gateway)
    expect(gateway.grant).toHaveBeenCalledWith({
      snapshot,
      expectedDigest: digest,
      backupCheckpointRef: 'backup-1',
      operator: 'operator-1',
      confirmAllWritersStopped: true
    })
    await fs.writeFile(output, JSON.stringify({ format: 'other', snapshot, digest }))
    await expect(executeMediaRecoveryCommand(command, gateway)).rejects.toThrow('does not match')
    expect(gateway.grant).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized and malformed snapshots before invoking a grant', async () => {
    const output = await temporary()
    const gateway = port()
    const command = {
      command: 'grant' as const,
      snapshotFile: output,
      expectedDigest: digest,
      backupCheckpointRef: 'b',
      operator: 'o',
      confirmAllWritersStopped: true as const
    }
    await fs.writeFile(output, Buffer.alloc(1024 * 1024 + 1))
    await expect(executeMediaRecoveryCommand(command, gateway)).rejects.toThrow('bounded')
    await fs.writeFile(output, '{')
    await expect(executeMediaRecoveryCommand(command, gateway)).rejects.toThrow()
    expect(gateway.grant).not.toHaveBeenCalled()
  })

  it('requires stop confirmation to resume only the explicit grant', async () => {
    const gateway = port()
    const args = ['resume', '--grant', 'grant-1', '--operator', 'operator-1']
    expect(() => parseMediaRecoveryCommand(args)).toThrow()
    const command = parseMediaRecoveryCommand([...args, '--confirm-all-writers-stopped'])
    await expect(executeMediaRecoveryCommand(command, gateway)).resolves.toMatchObject({
      jobId: 'job-1',
      status: 'PENDING'
    })
    expect(gateway.resume).toHaveBeenCalledWith(command)
    expect(gateway.grant).not.toHaveBeenCalled()
  })

  it('revokes an explicit grant without inspecting or granting another scope', async () => {
    const gateway = port()
    const command = parseMediaRecoveryCommand([
      'revoke',
      '--grant',
      'grant-1',
      '--operator',
      'operator-1',
      '--reason',
      'checkpoint changed'
    ])
    await expect(executeMediaRecoveryCommand(command, gateway)).resolves.toMatchObject({ status: 'REVOKED' })
    expect(gateway.inspect).not.toHaveBeenCalled()
    expect(gateway.grant).not.toHaveBeenCalled()
  })
})
