'use server'

import { cookies, headers } from 'next/headers'
import { actionClient } from '@/lib/safe-action'
import { validateCredentials } from '@/services/user-service'
import { sessionManager } from '@/lib/session'
import { authLoginSchema } from '@/schemas/auth.dto'
import { returnValidationErrors } from 'next-safe-action'

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
