'use server'

import { initializeAdmin, AlreadyInitializedError } from '@/services/init-admin-service'
import { parseSetCookieHeader } from 'better-auth/cookies'
import { APIError } from 'better-auth/api'
import { cookies } from 'next/headers'
import { actionClient } from '@/lib/safe-action'
import { z } from 'zod'

const initAdminSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(6).max(128)
})

export const initAdminAction = actionClient
  .inputSchema(initAdminSchema)
  .action(async ({ parsedInput: { username, password } }) => {
    try {
      const result = await initializeAdmin(username, password)
      const cookieStore = await cookies()
      parseSetCookieHeader(result.headers.get('set-cookie') ?? '').forEach((value, key) => {
        cookieStore.set(key, decodeURIComponent(value.value), {
          sameSite: value.samesite,
          secure: value.secure,
          maxAge: value['max-age'],
          httpOnly: value.httponly,
          domain: value.domain,
          path: value.path
        })
      })

      return { success: true }
    } catch (error) {
      console.error('Init admin failed:', error instanceof Error ? error.name : 'UnknownError')
      const errorMessage =
        error instanceof AlreadyInitializedError
          ? error.message
          : error instanceof APIError
            ? error.body?.message || '创建管理员失败'
            : '创建管理员失败'
      return { success: false, error: errorMessage }
    }
  })
