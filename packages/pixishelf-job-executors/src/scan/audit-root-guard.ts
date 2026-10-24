import { assertPixivRootUnchanged } from './root-identity.ts'
import type { SafeScanRoot } from './paths.ts'
import { ScanExecutorError } from './errors.ts'

export async function assertSameRoot(expected: SafeScanRoot, actual: SafeScanRoot) {
  await assertPixivRootUnchanged(expected)
  if (
    expected.absolutePath !== actual.absolutePath ||
    expected.deviceId !== actual.deviceId ||
    expected.inode !== actual.inode
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv scan root changed during the consistency audit')
  }
}

export function assertInventoryBarrier(
  state: {
    status: string
    baselineGeneration: number
    rootPathHash: string
    rootIdentity: string | null
    rootDeviceId: bigint | null
    rootInode: bigint | null
  },
  generation: number,
  rootPathHash: string,
  root: SafeScanRoot
) {
  if (
    state.status !== 'READY' ||
    state.baselineGeneration !== generation ||
    state.rootPathHash !== rootPathHash ||
    !root.rootIdentity ||
    state.rootIdentity !== root.rootIdentity
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv metadata inventory changed during the consistency audit')
  }
}

