'use server'

import { actionClient, ActionError, authActionClient } from '@/lib/safe-action'
import { auth } from '@/lib/auth'
import { authLoginSchema } from '@/schemas/auth.dto'
import { changePasswordSchema } from '@/schemas/users.dto'
import { returnValidationErrors } from 'next-safe-action'

export const loginUserAction = actionClient
  .inputSchema(authLoginSchema)
  .action(async ({ parsedInput: { username, password } }) => {
    try {
      // Convert username to email format
      const email = username.includes('@') ? username : `${username}@pixishelf.local`

      const signInResult = await auth.api.signInEmail({
        body: {
          email,
          password
        }
      })

      if (!signInResult) {
        return returnValidationErrors(authLoginSchema, {
          _errors: ['用户名或密码错误']
        })
      }

      return { id: signInResult.user.id }
    } catch (error) {
      return returnValidationErrors(authLoginSchema, {
        _errors: ['用户名或密码错误']
      })
    }
  })

export const logoutUserAction = actionClient.action(async () => {
  try {
    await auth.api.signOut()
  } catch (error) {
    return new ActionError('登出失败')
  }

  return { code: 0 }
})

export const changePasswordAction = authActionClient
  .inputSchema(changePasswordSchema)
  .action(async ({ parsedInput: { currentPassword, newPassword } }) => {
    try {
      await auth.api.changePassword({
        body: {
          newPassword: newPassword,
          currentPassword
        }
      })
    } catch (error) {
      return returnValidationErrors(changePasswordSchema, {
        _errors: [(error as Error).message]
      })
    }

    return { code: 0 }
  })
