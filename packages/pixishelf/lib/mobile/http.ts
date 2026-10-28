import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getMobileSession } from './auth'
import { rateLimiter } from '@/lib/rate-limit'
export const mobileHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}
export function mobileJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: mobileHeaders })
}
export class MobileError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code)
  }
}
export function mobileError(error: unknown): Response {
  if (error instanceof MobileError) return mobileJson({ error: { code: error.code } }, error.status)
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    {return mobileJson({ error: { code: 'INVALID_INPUT' } }, 400)}
  if (error instanceof TRPCError) {
    const statuses: Record<string, number> = {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      TOO_MANY_REQUESTS: 429
    }
    return mobileJson({ error: { code: error.code } }, statuses[error.code] ?? 500)
  }
  return mobileJson({ error: { code: 'INTERNAL_ERROR' } }, 500)
}
export async function mobileRoute(request: Request, run: (userId: string) => Promise<Response>) {
  try {
    const session = await getMobileSession(request.headers)
    if (!session?.user.id) throw new MobileError(401, 'UNAUTHORIZED')
    if (!rateLimiter.check(600, `mobile:${session.user.id}`)) throw new MobileError(429, 'RATE_LIMITED')
    return await run(session.user.id)
  } catch (error) {
    return mobileError(error)
  }
}
export function assertMobileAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new MobileError(403, 'ACCOUNT_CHANGED')
}
export async function mobileBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new MobileError(400, 'INVALID_INPUT')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64 * 1024) {
        await reader.cancel()
        throw new MobileError(413, 'BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
