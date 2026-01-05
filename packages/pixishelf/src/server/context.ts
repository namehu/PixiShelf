import { cookies } from 'next/headers'
import { sessionManager } from '@/lib/session'

/**
 * 创建 tRPC 上下文
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  
  const session = token ? await sessionManager.getSession(token) : null
  
  return {
    session,
    headers: opts.headers,
  }
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>
