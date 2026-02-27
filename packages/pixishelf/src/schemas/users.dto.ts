import { VALIDATION } from '@/lib/constants'
import { z } from 'zod'

/** 获取用户列表响应 Schema */
export const getUsersResponseDTO = z.array(
  z.object({
    id: z.string(),
    username: z.string().nullable().optional(), // UserBA.name
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    createdAt: z.date().or(z.string())
  })
)

export const createUserSchema = z.object({
  username: z
    .string({ error: '用户名不能为空' })
    .trim()
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

export const createUserResponseDTO = z.object({
  id: z.string()
})

/** 修改密码 Schema */
export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: '当前密码不能为空' }).min(1, '当前密码不能为空'),
  newPassword: z
    .string({ error: '新密码不能为空' })
    .min(1, '新密码不能为空')
    .min(VALIDATION.PASSWORD.MIN_LENGTH, `新密码长度不能少于${VALIDATION.PASSWORD.MIN_LENGTH}个字符`)
    .max(VALIDATION.PASSWORD.MAX_LENGTH, `新密码长度不能超过${VALIDATION.PASSWORD.MAX_LENGTH}个字符`)
})
