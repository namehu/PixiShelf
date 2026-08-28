import { TRPCError } from '@trpc/server'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import { getScanPath, getSystemSettings, setScanPath, upsertSystemSettings } from '@/services/setting.service'
import { systemSettingsResponseDTO, updateSystemSettingsSchema } from '@/schemas/system-setting.dto'
import {
  ArchiveDefaultTagBackfillServiceError,
  cancelArchiveDefaultTagBackfill,
  getArchiveDefaultTagBackfillStatus,
  previewArchiveDefaultTagBackfill,
  startArchiveDefaultTagBackfill
} from '@/services/archive-default-tag-backfill-service'
import z from 'zod'

export const settingRouter = router({
  /**
   * 健康检查
   * 以 SCAN_PATH 是否可读出作为系统级就绪信号，返回 ok/error 供前端环境检测。
   */
  health: authProcedure.query(async () => {
    const scanPath = await getScanPath()
    return { status: scanPath ? 'ok' : 'error' }
  }),
  /**
   * 获取扫描路径
   */
  getScanPath: authProcedure.query(async () => {
    const data = await getScanPath()
    return { data: data }
  }),

  /**
   * 设置扫描路径
   * 仅持久化入库，不返回具体内容，调用方应自行拉取最新配置确认写入结果。
   */
  setScanPath: authProcedure.input(z.object({ value: z.string() })).mutation(async ({ input }) => {
    await setScanPath(input.value)
  }),

  getSystemSettings: authProcedure.query(async () => {
    const settings = await getSystemSettings()
    return systemSettingsResponseDTO.parse({ settings })
  }),

  updateSystemSettings: authProcedure.input(updateSystemSettingsSchema).mutation(async ({ input }) => {
    const settings = await upsertSystemSettings(input)
    return systemSettingsResponseDTO.parse({ settings })
  }),

  getArchiveDefaultTagBackfillStatus: authProcedure.query(() => getArchiveDefaultTagBackfillStatus()),

  previewArchiveDefaultTagBackfill: adminProcedure.query(() => previewArchiveDefaultTagBackfill()),

  startArchiveDefaultTagBackfill: adminProcedure
    .input(z.object({ snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        return await startArchiveDefaultTagBackfill({
          requestedByUserId: ctx.userId,
          snapshotDigest: input.snapshotDigest
        })
      } catch (error) {
        throwArchiveDefaultTagBackfillError(error)
      }
    }),

  cancelArchiveDefaultTagBackfill: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }).strict())
    .mutation(async ({ input }) => cancelArchiveDefaultTagBackfill(input.jobId))
})

function throwArchiveDefaultTagBackfillError(error: unknown): never {
  if (error instanceof ArchiveDefaultTagBackfillServiceError) {
    throw new TRPCError({
      code: error.code === 'STALE_PREVIEW' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.message
    })
  }
  if (error instanceof Error) throw error
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '历史归档标签补全启动失败' })
}
