import z from 'zod'

/** 登录成功响应 DTO */
export const AuthMeResponseDTO = z.object({
  id: z.number().int().positive(),
  username: z.string()
})

export type AuthMeResponseDTO = z.infer<typeof AuthMeResponseDTO>
