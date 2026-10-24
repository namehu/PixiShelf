import * as fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import {
  renameMaintenanceFile,
  ensureMaintenanceDirectory,
  syncMaintenanceDirectory,
  probeMaintenanceFilesystem
} from '../maintenance-files.ts'

const marker = (id = '11111111-1111-4111-8111-111111111111') => JSON.stringify({ version: 1, id })
function tree(directory: string): string[] {
  return fs
    .readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const full = path.join(directory, name)
      return fs.lstatSync(full).isDirectory()
        ? [`${name}/`, ...tree(full).map((entry) => `${name}/${entry}`)]
        : [`${name}:${fs.readFileSync(full).toString('hex')}`]
    })
}
process.on('disconnect', () => process.exit(0))
process.once(
  'message',
  async (message: { directory: string; scenario: string; action?: string; markerChange?: string }) => {
    const rootPath = path.join(message.directory, 'root')
    const outside = path.join(message.directory, 'outside')
    fs.mkdirSync(rootPath)
    fs.mkdirSync(outside)
    fs.mkdirSync(path.join(rootPath, 'parent/child'), { recursive: true })
    fs.mkdirSync(path.join(rootPath, 'target'))
    fs.writeFileSync(path.join(rootPath, 'parent/child/source'), 'inside')
    if (message.markerChange && message.markerChange !== 'ADD')
      fs.writeFileSync(path.join(rootPath, '.pixishelf-root'), marker())
    const { source: root } = await resolveMediaContentRoots({
      sourceRoot: rootPath,
      archiveRoot: rootPath,
      expectedPixivRootIdentity: null
    })
    const adapter = createRequire(import.meta.url)(
      new URL('../../../../pixishelf-worker/dist/artwork-dedup-native.node', import.meta.url).pathname
    ) as Record<string, (fd: number, name: string) => number | void>
    let swapped = false
    let outsideBefore: string[] | undefined
    const changeMarker = () => {
      if (message.markerChange === 'REMOVE') fs.unlinkSync(path.join(rootPath, '.pixishelf-root'))
      else fs.writeFileSync(path.join(rootPath, '.pixishelf-root'), marker('22222222-2222-4222-8222-222222222222'))
    }
    if (message.scenario === 'MARKER') changeMarker()
    if (message.scenario === 'ANCESTOR') {
      const action = message.action!
      const method = action === 'rename' ? 'openDirectoryAt' : action
      const original = adapter[method]!
      adapter[method] = (fd, name) => {
        const trigger =
          action === 'rename'
            ? name === 'parent'
            : action === 'mkdirAt'
              ? name === 'operation-test'
              : action === 'createFileAt'
                ? name === 'source'
                : action === 'unlinkAt'
                  ? name === 'occupied'
                  : name.startsWith('probe-')
        if (!swapped && trigger) {
          const ancestor = action === 'rename' ? 'parent' : '.trash'
          fs.cpSync(path.join(rootPath, ancestor), outside, { recursive: true })
          if (action === 'rename') fs.writeFileSync(path.join(outside, 'child/source'), 'outside')
          outsideBefore = tree(outside)
          fs.renameSync(path.join(rootPath, ancestor), path.join(rootPath, `${ancestor}-original`))
          fs.symlinkSync(outside, path.join(rootPath, ancestor))
          swapped = true
        }
        return original(fd, name)
      }
    }
    if (message.scenario === 'LATE_MARKER') {
      const original = adapter.openDirectoryAt!
      adapter.openDirectoryAt = (fd, name) => {
        const result = original(fd, name)
        if (name === 'target') {
          changeMarker()
          swapped = true
        }
        return result
      }
    }
    let resultCode = 'SUCCESS'
    try {
      if (message.action === 'rename' || message.scenario === 'LATE_MARKER')
        await renameMaintenanceFile(root, 'parent/child/source', 'target/moved')
      else if (message.action === 'ensure')
        await ensureMaintenanceDirectory(root, '.trash/artwork-dedup/operation-test')
      else if (message.action === 'sync') await syncMaintenanceDirectory(root, '')
      else
        await probeMaintenanceFilesystem({ root, operationId: 'operation-test', signal: new AbortController().signal })
    } catch (error) {
      resultCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error)
    }
    process.send?.(
      {
        code: resultCode,
        swapped,
        outsideUnchanged: outsideBefore ? JSON.stringify(outsideBefore) === JSON.stringify(tree(outside)) : true,
        trashExists: fs.existsSync(path.join(rootPath, '.trash')),
        targetExists: fs.existsSync(path.join(rootPath, 'target/moved')),
        originalSource: fs.readFileSync(
          path.join(
            rootPath,
            message.scenario === 'ANCESTOR' && message.action === 'rename'
              ? 'parent-original/child/source'
              : 'parent/child/source'
          ),
          'utf8'
        )
      },
      () => process.disconnect()
    )
  }
)
