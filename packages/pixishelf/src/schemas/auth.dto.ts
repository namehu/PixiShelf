import z from 'zod'
import { VALIDATION } from '@/lib/constants'

/** 登录请求 DTO */
export const AuthLoginSchema = z.object({
  username: z
    .string({ error: '用户名不能为空' })
    .min(1, '用户名不能为空')
    .min(VALIDATION.USERNAME.MIN_LENGTH, `用户名长度不能少于${VALIDATION.USERNAME.MIN_LENGTH}个字符`)
    .max(VALIDATION.USERNAME.MAX_LENGTH, `用户名长度不能超过${VALIDATION.USERNAME.MAX_LENGTH}个字符`)
    .regex(VALIDATION.USERNAME.PATTERN, '用户名只能包含字母、数字、下划线和连字符'),
  password: z
    .string({ error: '密码不能为空' })
    .min(1, '密码不能为空')
    .min(VALIDATION.PASSWORD.MIN_LENGTH, `密码长度不能少于${VALIDATION.PASSWORD.MIN_LENGTH}个字符`)
    .max(VALIDATION.PASSWORD.MAX_LENGTH, `密码长度不能超过${VALIDATION.PASSWORD.MAX_LENGTH}个字符`)
})
export type AuthLoginSchema = z.infer<typeof AuthLoginSchema>

/** 登录成功响应 DTO */
export const AuthLoginResponseDTO = z.object({
  id: z.number().int().positive()
})
export type AuthLoginResponseDTO = z.infer<typeof AuthLoginResponseDTO>

/** 登录用户响应 DTO */
export const AuthMeResponseDTO = z.object({
  id: z
    .number()
    .int()
    .positive()
    // cookie 中 id 为字符串.转换为数字
    .or(z.string().transform((val) => Number(val))),
  username: z.string()
})
export type AuthMeResponseDTO = z.infer<typeof AuthMeResponseDTO>
