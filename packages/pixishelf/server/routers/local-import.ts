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

    void (async () => {
      try {
        const result = await runLocalImport({
          scanPath,
          defaultTagIds: systemSettings.local_import_default_tag_ids,
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
        await JobService.completeJob(job.id, result)
      } catch (error) {
        logger.error('Local directory import failed', { error, jobId: job.id })
        const current = await JobService.getJob(job.id)
        if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
          await JobService.markAsCancelled(job.id)
        } else {
          await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
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
