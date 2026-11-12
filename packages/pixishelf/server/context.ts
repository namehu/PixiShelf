import { auth } from '@/lib/auth'
import { measureArchiveReadPhase } from '@/lib/archive-read-timing'

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await measureArchiveReadPhase('session', () => auth.api.getSession({ headers: opts.headers }))

  return {
    session: session?.session,
    user: session?.user,
    userId: session?.user?.id,
    headers: opts.headers
  }
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>
