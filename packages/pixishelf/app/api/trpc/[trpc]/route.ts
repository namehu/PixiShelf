import logger from '@/lib/logger'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server'
import { createTRPCContext } from '@/server/context'
import { withArchiveReadTiming } from '@/lib/archive-read-timing'

const handler = (req: Request) =>
  withArchiveReadTiming(req, () =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req,
      router: appRouter,
      onError: ({ error }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') logger.error('tRPC request failed', { error })
      },
      createContext: () => createTRPCContext({ headers: req.headers })
    })
  )

export { handler as GET, handler as POST }
