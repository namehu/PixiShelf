import z from 'zod'

/**
 * 健康检查响应体
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok').or(z.literal('error')),
  scanPath: z.string().optional()
})

export type HealthResponseSchema = z.infer<typeof HealthResponseSchema>
