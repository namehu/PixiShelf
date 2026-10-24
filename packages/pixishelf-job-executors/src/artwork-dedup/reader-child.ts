import {
  inspectMaintenanceSource,
  MaintenanceSourceError,
  maintenanceSourceIdentitySchema
} from './maintenance-source.ts'
import { inspectReaderOwner } from './reader-owner.ts'
import { inspectMediaContentFile, readMediaContentFile } from '../media-content/file-reader.ts'
import { MediaContentFileError, resolveMediaContentRoots } from '../media-content/roots.ts'
import { ARTWORK_DEDUP_LIMITS as limits } from './limits.ts'
import { isExclusiveReaderOperation, type ReaderRequest, type ReaderResponse } from './reader-protocol.ts'
import {
  deleteMaintenanceFile,
  inspectMaintenanceFile,
  inspectMaintenanceDirectory,
  probeMaintenanceFilesystem,
  MaintenanceFileError
} from './maintenance-files.ts'

const active = new Set<number>()
const progressPending = new Set<number>()
let hashes = 0
let roots = 0
const signal = new AbortController().signal
function send(value: ReaderResponse) {
  if (process.connected)
    process.send?.(value, (error: Error | null) => {
      if (error) process.exit(1)
    })
}
function validPath(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= limits.maxPathBytes && !value.includes('\0')
}
function validRequest(value: unknown): value is ReaderRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<ReaderRequest>
  if (request.type !== 'request' || !Number.isSafeInteger(request.id)) return false
  if (request.operation === 'roots')
    return (
      validPath(request.sourceRoot) &&
      validPath(request.archiveRoot) &&
      (request.expectedPixivRootIdentity === null ||
        (typeof request.expectedPixivRootIdentity === 'string' && request.expectedPixivRootIdentity.length <= 128))
    )
  if (
    !('root' in request) ||
    !request.root ||
    !validPath(request.root.absolutePath) ||
    !['source-media:v1', 'archive-media:v1'].includes(request.root.logicalRoot) ||
    !/^[a-f0-9]{64}$/.test(request.root.rootIdentity) ||
    typeof request.root.deviceId !== 'bigint' ||
    typeof request.root.inode !== 'bigint'
  )
    return false
  if (request.operation === 'maintenance-capability')
    return typeof request.operationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(request.operationId)
  if (!('relativePath' in request) || !validPath(request.relativePath)) return false
  if (request.operation === 'direct-delete') return typeof request.allowMissing === 'boolean' && !!request.expectedState && ['size','mtimeNs','ctimeNs','deviceId','inode','linkCount'].every(field => typeof (request.expectedState as unknown as Record<string,unknown>)[field] === 'bigint')
  if (request.operation === 'maintenance-source')
    return (
      Number.isSafeInteger(request.offset) &&
      request.offset! >= 0 &&
      maintenanceSourceIdentitySchema.safeParse(request.expectedIdentity).success
    )
  if (request.operation === 'maintenance-directory')
    return (
      (request.afterName === null || validPath(request.afterName)) &&
      (request.expectedState === null ||
        (!!request.expectedState &&
          ['size', 'mtimeNs', 'ctimeNs', 'deviceId', 'inode', 'linkCount'].every(
            (field) => typeof (request.expectedState as unknown as Record<string, unknown>)[field] === 'bigint'
          )))
    )
  return request.operation === 'inspect' || request.operation === 'read' || request.operation === 'maintenance-inspect'
}
process.on('disconnect', () => process.exit(0))
function acceptMessage(message: unknown) {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'ack' &&
    'id' in message &&
    typeof message.id === 'number'
  ) {
    progressPending.delete(message.id)
    return
  }
  if (
    !validRequest(message) ||
    active.has(message.id) ||
    active.size >= limits.statConcurrency ||
    roots > 0 ||
    (message.operation === 'read' && hashes > 0) ||
    (isExclusiveReaderOperation(message.operation) && active.size > 0)
  ) {
    process.exit(1)
  }
  const request = message as ReaderRequest
  active.add(request.id)
  if (request.operation === 'read') hashes++
  if (isExclusiveReaderOperation(request.operation)) roots++
  void (async () => {
    let bytesRead = 0n
    try {
      let lastProgress = 0
      const onProgress = (totalBytes: bigint) => {
        bytesRead = totalBytes
        const now = Date.now()
        if (now - lastProgress < limits.progressIpcMs || progressPending.has(request.id)) return
        lastProgress = now
        progressPending.add(request.id)
        send({ type: 'progress', id: request.id, bytesRead, rss: process.memoryUsage().rss })
      }
      const value =
        request.operation === 'direct-delete' ? await deleteMaintenanceFile({...request,signal}) : request.operation === 'roots'
          ? await resolveMediaContentRoots(request)
          : request.operation === 'maintenance-source'
            ? await inspectMaintenanceSource({ ...request, signal, onProgress })
            : request.operation === 'maintenance-inspect'
              ? await inspectMaintenanceFile({ ...request, signal })
              : request.operation === 'maintenance-directory'
                ? await inspectMaintenanceDirectory({ ...request, signal })
                : request.operation === 'maintenance-capability'
                  ? await probeMaintenanceFilesystem({ ...request, signal })
                  : request.operation === 'inspect'
                    ? await inspectMediaContentFile({ ...request, signal })
                    : await readMediaContentFile({
                        ...request,
                        signal,
                        onProgress
                      })
      send({ type: 'result', id: request.id, value, rss: process.memoryUsage().rss })
    } catch (error) {
      // Root and execution failures stop the run; individual unreadable files remain local.
      const code =
        request.operation === 'roots'
          ? 'ROOT_CHANGED'
          : error instanceof MediaContentFileError ||
              error instanceof MaintenanceFileError ||
              error instanceof MaintenanceSourceError
            ? error.code
            : error &&
                typeof error === 'object' &&
                'code' in error &&
                ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(String(error.code))
              ? 'NOT_READABLE'
              : 'READER_ENVIRONMENT'
      send({ type: 'error', id: request.id, code, bytesRead, rss: process.memoryUsage().rss })
    } finally {
      active.delete(request.id)
      progressPending.delete(request.id)
      if (request.operation === 'read') hashes--
      if (isExclusiveReaderOperation(request.operation)) roots--
    }
  })()
}

void inspectReaderOwner()
  .then((owner) => {
    if (process.argv.includes('--owner-probe')) {
      const pid = Number(process.argv.at(-1))
      let pidAbsent = false
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
        } catch (error) {
          pidAbsent = !!error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
        }
      }
      process.send?.({ type: 'owner-proof', owner, pidAbsent }, () => process.disconnect())
    } else {
      process.on('message', acceptMessage)
      process.send?.({ type: 'ready', owner })
    }
  })
  .catch(() => process.exit(1))
