import 'server-only'

import { auth } from '@/lib/auth'
import { ApiError } from '@/lib/api-handler'

export async function requireAdminRequest(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user?.id) throw new ApiError('Unauthorized', 401)
  return { userId: session.user.id }
}
