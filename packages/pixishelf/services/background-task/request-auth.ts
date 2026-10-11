import 'server-only'

import logger from '@/lib/logger'
import { auth } from '@/lib/auth'
import { ApiError } from '@/lib/api-handler'

export async function requireAdminRequest(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers }).catch((error: unknown) => {
    logger.error('Request session lookup failed', { error })
    throw new ApiError('Internal Server Error', 500)
  })
  if (!session?.user?.id) throw new ApiError('Unauthorized', 401)
  return { userId: session.user.id }
}
