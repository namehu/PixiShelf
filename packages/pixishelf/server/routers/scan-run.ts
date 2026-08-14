import { z } from 'zod'
import { ScanRunItemStatus } from '@prisma/client'
import { authProcedure, router } from '@/server/trpc'
import { getLatestScanRun, getScanRunDetail, listScanRuns } from '@/services/scan-run-service'

export const scanRunRouter = router({
  /**
   * latest 仅返回最近一次扫描记录；list 支持可选分页，status 用于可选筛选扫描项状态。
   */
  latest: authProcedure.query(async () => {
    return getLatestScanRun()
  }),

  list: authProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional()
        })
        .optional()
    )
    .query(async ({ input }) => {
      return listScanRuns({ limit: input?.limit })
    }),

  detail: authProcedure
    .input(
      z.object({
        scanRunId: z.string().min(1),
        status: z.nativeEnum(ScanRunItemStatus).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        cursor: z.string().min(1).optional()
      })
    )
    .query(async ({ input }) => {
      return getScanRunDetail(input)
    })
})
