import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import { renameMaintenanceFile } from '../maintenance-files.ts'

process.on('disconnect', () => process.exit(0))
process.once('message', async (message: { root: string; from: string; to: string; waitBeforeMove?: boolean }) => {
  try {
    const { source } = await resolveMediaContentRoots({
      sourceRoot: message.root,
      archiveRoot: message.root,
      expectedPixivRootIdentity: null
    })
    if (message.waitBeforeMove) {
      // Deliberately block this process before its synchronous native call, never a helper process.
      process.send?.({ type: 'ready', pid: process.pid }, () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
        void renameMaintenanceFile(source, message.from, message.to).then(() => process.disconnect())
      })
      return
    }
    await renameMaintenanceFile(source, message.from, message.to)
    process.send?.({ type: 'result' }, () => process.disconnect())
  } catch (error) {
    process.send?.(
      { type: 'error', code: error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN' },
      () => process.disconnect()
    )
  }
})
