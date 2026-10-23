import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { readFile, readlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { DedupReaderOptions } from './reader.ts'

export interface DedupReaderOwner {
  version: 1
  machineId: string
  bootId: string
  pidNamespace: string
  parentPid: number
  childPid: number
}
const execute = promisify(execFile)
/** Called only inside the fixed child, before it accepts any media operation. */
export async function inspectReaderOwner(): Promise<DedupReaderOwner> {
  let machine: string, boot: string, namespace: string
  if (process.platform === 'linux') {
    ;[machine, boot, namespace] = await Promise.all([
      readFile('/etc/machine-id', 'utf8').catch(() => ''),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readlink('/proc/self/ns/pid')
    ])
    // Minimal containers commonly have no machine-id. A boot-scoped identity still proves
    // same-boot, same-namespace PID absence; a reboot then requires explicit recovery.
    machine = machine.trim() || `linux-boot:${boot.trim()}`
  } else if (process.platform === 'darwin') {
    const [hardware, startup] = await Promise.all([
      execute('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 5000, maxBuffer: 64 * 1024 }),
      execute('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { timeout: 5000, maxBuffer: 4096 })
    ])
    const uuid = /"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]+)"/.exec(hardware.stdout)?.[1]
    if (!uuid) throw new Error('Machine identity unavailable')
    machine = uuid
    boot = startup.stdout
    namespace = 'darwin-host'
  } else throw new Error('Reader owner verification is unavailable on this platform')
  if (![machine, boot, namespace].every((value) => value.trim().length > 0 && value.length < 4096))
    throw new Error('Invalid process identity')
  return {
    version: 1,
    machineId: digest(machine.trim()),
    bootId: digest(boot.trim()),
    pidNamespace: namespace.trim(),
    parentPid: process.ppid,
    childPid: process.pid
  }
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
export function isReaderOwner(value: unknown): value is DedupReaderOwner {
  if (!value || typeof value !== 'object') return false
  const owner = value as Partial<DedupReaderOwner>
  return (
    owner.version === 1 &&
    typeof owner.machineId === 'string' &&
    /^[a-f0-9]{64}$/.test(owner.machineId) &&
    typeof owner.bootId === 'string' &&
    /^[a-f0-9]{64}$/.test(owner.bootId) &&
    typeof owner.pidNamespace === 'string' &&
    owner.pidNamespace.length < 4096 &&
    Number.isSafeInteger(owner.parentPid) &&
    owner.parentPid! > 0 &&
    Number.isSafeInteger(owner.childPid) &&
    owner.childPid! > 0
  )
}
export function ownerProvesExit(old: DedupReaderOwner, observed: DedupReaderOwner, pidAbsent: boolean): boolean {
  if (old.machineId !== observed.machineId) return false
  if (old.bootId !== observed.bootId) return true
  return old.pidNamespace === observed.pidNamespace && pidAbsent
}
let ownerProbeActive = false
let ownerProbeBlocked = false

/** This fixed mode has no media message handler, so it is safe while an old reader is unresolved. */
export async function proveReaderExited(options: DedupReaderOptions, owner: DedupReaderOwner): Promise<boolean> {
  if (ownerProbeActive || ownerProbeBlocked) return false
  ownerProbeActive = true
  const child = spawn(
    process.execPath,
    [...(options.execArgv ?? []), options.entrypoint, '--owner-probe', String(owner.childPid)],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
      env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV }
    }
  )
  return new Promise((resolve) => {
    let proven = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.stallMs ?? 30_000)
    child.once('error', () => {
      proven = false
    })
    child.on('message', (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const result = value as { type?: string; owner?: unknown; pidAbsent?: unknown }
      if (result.type === 'owner-proof' && isReaderOwner(result.owner))
        proven = ownerProvesExit(owner, result.owner, result.pidAbsent === true)
    })
    child.once('close', () => {
      clearTimeout(timer)
      clearTimeout(closeDeadline)
      ownerProbeActive = false
      resolve(proven)
    })
    // An unclosed verifier never authorizes clearing a reader token.
    const closeDeadline = setTimeout(
      () => {
        ownerProbeBlocked = true
        resolve(false)
      },
      (options.stallMs ?? 30_000) + (options.closeMs ?? 5000)
    )
    closeDeadline.unref()
  })
}
