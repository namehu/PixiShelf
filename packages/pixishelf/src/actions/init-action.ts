'use server'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
      // 检查用户是否已存在
      const existingUser = await prisma.userBA.findFirst({
        where: {
          OR: [{ email: `${username}@pixishelf.local` }, { name: username }]
        }
      })

      if (existingUser) {
        return { success: false, error: '用户已存在' }
      }

      await auth.api.signUpEmail({
        body: {
          email: `${username}@pixishelf.local`,
          password,
          name: username
        }
      })

      return { success: true }
    } catch (error: any) {
      console.error('Init admin error:', error)
      const errorMessage = error?.body?.message || error?.message || '创建管理员失败'
      return { success: false, error: errorMessage }
    }
  })
