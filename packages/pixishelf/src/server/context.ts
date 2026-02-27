import { auth } from '@/lib/auth'

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await auth.api.getSession({
    headers: opts.headers
  })

  return {
    session: session?.session,
    user: session?.user,
    userId: session?.user?.id,
    headers: opts.headers
  }
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>
