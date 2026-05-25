'use server'

import { actionClient, ActionError, authActionClient } from '@/lib/safe-action'
import { auth } from '@/lib/auth'
import { authLoginSchema } from '@/schemas/auth.dto'
import { changePasswordSchema } from '@/schemas/users.dto'
import { returnValidationErrors } from 'next-safe-action'
import { headers } from 'next/headers'
import { checkRateLimit } from '@/lib/rate-limit-server'

export const loginUserAction = actionClient
  .inputSchema(authLoginSchema)
  .action(async ({ parsedInput: { username, password } }) => {
    // Rate limit: 5 attempts per minute
    const isAllowed = await checkRateLimit(5, 'login')
    if (!isAllowed) {
      return returnValidationErrors(authLoginSchema, {
        _errors: ['尝试次数过多，请稍后再试']
      })
    }

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

export const changePasswordAction = authActionClient
  .inputSchema(changePasswordSchema)
  .action(async ({ parsedInput: { currentPassword, newPassword } }) => {
    // Rate limit: 5 attempts per minute
    const isAllowed = await checkRateLimit(5, 'changePassword')
    if (!isAllowed) {
      return returnValidationErrors(changePasswordSchema, {
        _errors: ['尝试次数过多，请稍后再试']
      })
    }

    try {
      await auth.api.changePassword({
        body: {
          newPassword: newPassword,
          currentPassword
        },
        headers: await headers()
      })
    } catch (error) {
      return returnValidationErrors(changePasswordSchema, {
        _errors: [(error as Error).message]
      })
    }

    return { code: 0 }
  })
