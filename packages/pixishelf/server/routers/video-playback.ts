import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { adminProcedure, router } from '@/server/trpc'
import { prisma } from '@/lib/prisma'
import { cancelJobCommand, retryJobCommand } from '@/services/background-task'
import { submitVideoPlayback, videoPlaybackStatuses, removeVideoPlayback } from '@/services/video-playback-service'

const targets = z.object({ imageIds: z.array(z.number().int().positive()).min(1).max(1000) })
export const videoPlaybackRouter = router({
  generate: adminProcedure.input(targets).mutation(({ ctx, input }) => submitVideoPlayback(input.imageIds, ctx.userId)),
  statuses: adminProcedure.input(targets).query(({ input }) => videoPlaybackStatuses(input.imageIds)),
  remove: adminProcedure
    .input(z.object({ imageId: z.number().int().positive() }))
    .mutation(({ input }) => removeVideoPlayback(input.imageId)),
  retry: adminProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const job = await prisma.systemJob.findUnique({ where: { id: input.jobId }, select: { type: true } })
    if (job?.type !== 'VIDEO_PLAYBACK_GENERATION') {
      throw new TRPCError({ code: 'NOT_FOUND', message: '播放副本任务不存在' })
    }
    return retryJobCommand({ ...input, requestedByUserId: ctx.userId })
  }),
  cancel: adminProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input }) => {
    const job = await prisma.systemJob.findUnique({ where: { id: input.jobId }, select: { type: true } })
    if (job?.type !== 'VIDEO_PLAYBACK_GENERATION') {
      throw new TRPCError({ code: 'NOT_FOUND', message: '播放副本任务不存在' })
    }
    await cancelJobCommand(input)
    return { success: true }
  })
})
