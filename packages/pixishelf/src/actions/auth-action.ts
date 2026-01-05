'use server'

import { cookies, headers } from 'next/headers'
import { actionClient, ActionError, authActionClient } from '@/lib/safe-action'
import { changePassword, validateCredentials } from '@/services/user-service'
import { sessionManager } from '@/lib/session'
import { authLoginSchema } from '@/schemas/auth.dto'
import { changePasswordSchema } from '@/schemas/users.dto'
import { returnValidationErrors } from 'next-safe-action'

/**
 * 登录用户操作
 */
export const loginUserAction = actionClient
  .inputSchema(authLoginSchema)
  .action(async ({ parsedInput: { username, password } }) => {
    // 验证用户凭据
    const user = await validateCredentials(username, password)
    if (!user) {
      return returnValidationErrors(authLoginSchema, {
        _errors: ['用户名或密码错误']
      })
    }

    // 创建会话
    const session = await sessionManager.createSession(user)

    const cookieOptions = sessionManager.getCookieOptions(await headers())
    const cookieStore = await cookies()

    cookieStore.set('auth-token', session.token, {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite as any,
      maxAge: cookieOptions.maxAge,
      path: cookieOptions.path
    })

    return { id: user.id }
  })

/**
 * 登出用户操作
 */
export const logoutUserAction = actionClient.action(async () => {
  try {
    const cookieStore = await cookies()
    cookieStore.delete('auth-token')
  } catch (error) {
    return new ActionError('登出失败')
  }

  return { code: 0 }
})

/**
 * 修改密码
 */
export const changePasswordAction = authActionClient
  .inputSchema(changePasswordSchema)
  .action(async ({ parsedInput: { currentPassword, newPassword }, ctx: { userId } }) => {
    try {
      await changePassword(userId, currentPassword, newPassword)
    } catch (error) {
      return returnValidationErrors(changePasswordSchema, {
        _errors: [(error as Error).message]
      })
    }

    return { code: 0 }
  })
