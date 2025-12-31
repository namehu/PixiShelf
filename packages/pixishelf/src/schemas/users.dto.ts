import { VALIDATION } from '@/lib/constants'
import { z } from 'zod'

/** 删除用户 Schema */
export const UserDeleteSchema = z.object({
  id: z.coerce.number({ error: '用户ID必须是数字' }).int('用户ID必须是整数').positive('用户ID必须是正数')
})

export type UserDeleteSchema = z.infer<typeof UserDeleteSchema>

/** 获取用户列表 Schema */
export const GetUsersSchema = z.object({})
export type GetUsersSchema = z.infer<typeof GetUsersSchema>

/** 获取用户列表响应 Schema */
export const GetUsersResponseDTO = z.array(
  z.object({
    id: z.number(),
    username: z.string(),
    createdAt: z.date().or(z.string())
  })
)
export type GetUsersResponseDTO = z.infer<typeof GetUsersResponseDTO>

/** 创建用户 Schema */
export const CreateUserSchema = z.object({
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
export type CreateUserSchema = z.infer<typeof CreateUserSchema>

/** 创建用户响应 Schema */
export const CreateUserResponseDTO = z.object({
  id: z.number()
})
export type CreateUserResponseDTO = z.infer<typeof CreateUserResponseDTO>

/** 修改密码 Schema */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string({ error: '当前密码不能为空' }).min(1, '当前密码不能为空'),
  newPassword: z
    .string({ error: '新密码不能为空' })
    .min(1, '新密码不能为空')
    .min(VALIDATION.PASSWORD.MIN_LENGTH, `新密码长度不能少于${VALIDATION.PASSWORD.MIN_LENGTH}个字符`)
    .max(VALIDATION.PASSWORD.MAX_LENGTH, `新密码长度不能超过${VALIDATION.PASSWORD.MAX_LENGTH}个字符`)
})
export type ChangePasswordSchema = z.infer<typeof ChangePasswordSchema>
