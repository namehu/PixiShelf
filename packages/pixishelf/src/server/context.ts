import { cookies } from 'next/headers'
import { sessionManager } from '@/lib/session'
import { COOKIE_AUTH_TOKEN } from '@/lib/constants'

/**
 * 创建 tRPC 上下文
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_AUTH_TOKEN)?.value

  const session = token ? await sessionManager.getSession(token) : null

  return {
    session,
    userId: session?.userId ? Number(session.userId) : undefined,
    headers: opts.headers
  }
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>
