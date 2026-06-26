import { TRPCError } from '@trpc/server'
import { authProcedure, router } from '@/server/trpc'
import { saveLocalImportArtistMappingsSchema } from '@/schemas/local-import.dto'
import { getScanPath, getSystemSettings } from '@/services/setting.service'
import {
  discoverLocalImports,
  runLocalImport,
  saveLocalImportArtistMappings
} from '@/services/local-import-service'
import * as JobService from '@/services/job-service'
import logger from '@/lib/logger'
import { ScanRunMode, ScanRunType } from '@prisma/client'
import {
  cancelScanRun,
  completeScanRunSummary,
  createScanRunItemBuffer,
  failScanRun,
  startScanRun
} from '@/services/scan-run-service'

async function requireScanPath() {
  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  }
  return scanPath
}

export const localImportRouter = router({
  preview: authProcedure.query(async () => {
    const scanPath = await requireScanPath()
    return discoverLocalImports({ scanPath })
  }),

  saveMappings: authProcedure.input(saveLocalImportArtistMappingsSchema).mutation(async ({ input }) => {
    return saveLocalImportArtistMappings(input)
  }),

  start: authProcedure.mutation(async () => {
    const scanPath = await requireScanPath()
    const systemSettings = await getSystemSettings()
    let job
    try {
      job = await JobService.createLocalDirectoryImportJob()
    } catch (error) {
      if (error instanceof Error && error.message.includes('already in progress')) {
        throw new TRPCError({ code: 'CONFLICT', message: error.message })
      }
      throw error
    }
    const scanRun = await startScanRun({
      systemJobId: job.id,
      type: ScanRunType.LOCAL_IMPORT,
      mode: ScanRunMode.LOCAL_DIRECTORY_IMPORT
    })
    const auditBuffer = createScanRunItemBuffer(scanRun.id)

    void (async () => {
      try {
        const result = await runLocalImport({
          scanPath,
          defaultTagIds: systemSettings.local_import_default_tag_ids,
          audit: {
            recordItems: auditBuffer.recordItems
          },
          checkCancelled: async () => {
            const current = await JobService.getJob(job.id)
            return current?.status === 'CANCELLING'
          },
          onProgress: async ({ current, total, artistDirectory, relativeDirectory, status }) => {
            const percentage = total > 0 ? Math.round(5 + (current / total) * 90) : 95
            await JobService.updateProgress(
              job.id,
              percentage,
              `${artistDirectory}/${relativeDirectory}: ${status}`
            )
          }
        })
        await auditBuffer.flush()
        await JobService.completeJob(job.id, result)
        await completeScanRunSummary(scanRun.id, {
          totalArtworks: result.total,
          skippedArtworks: result.skipped,
          newImages: result.newImages,
          durationMs: result.processingTime,
          errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('\n') : null
        })
      } catch (error) {
        logger.error('Local directory import failed', { error, jobId: job.id })
        const current = await JobService.getJob(job.id)
        await auditBuffer.flush()
        if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
          await JobService.markAsCancelled(job.id)
          await cancelScanRun(scanRun.id)
        } else {
          const message = error instanceof Error ? error.message : 'Unknown error'
          await JobService.failJob(job.id, message)
          await failScanRun(scanRun.id, message)
        }
      }
    })()

    return { jobId: job.id }
  }),

  status: authProcedure.query(async () => {
    const [job, activity] = await Promise.all([
      JobService.getLatestLocalDirectoryImportJob(),
      JobService.getMediaScanActivity()
    ])
    return { job, activity }
  }),

  cancel: authProcedure.mutation(async () => {
    const job = await JobService.getActiveLocalDirectoryImportJob()
    if (!job) return { success: false }
    await JobService.cancelJob(job.id)
    return { success: true }
  })
})
