import { mobileAuth, mobileAuthHeaders, getMobileSession } from '@/lib/mobile/auth'
import { mobileBody, mobileError, MobileError, mobileJson, mobileRoute } from '@/lib/mobile/http'
import { authLoginSchema } from '@/schemas/auth.dto'
import { rateLimiter } from '@/lib/rate-limit'
import { z } from 'zod'
export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!rateLimiter.check(5, `login:${ip}`)) throw new MobileError(429, 'RATE_LIMITED')
    const { username, password } = authLoginSchema.parse(await mobileBody(request))
    const response = await mobileAuth.api.signInEmail({
      body: { email: username.includes('@') ? username : `${username}@pixishelf.local`, password },
      headers: mobileAuthHeaders(
        new Headers({ 'x-forwarded-for': ip, 'user-agent': request.headers.get('user-agent') || 'PixiShelf Android' })
      ),
      asResponse: true
    })
    if (!response.ok) throw new MobileError(401, 'INVALID_CREDENTIALS')
    const token = response.headers.get('set-auth-token')
    if (!token) throw new MobileError(500, 'SESSION_UNAVAILABLE')
    const session = await getMobileSession(new Headers({ authorization: `Bearer ${token}` }))
    if (!session) throw new MobileError(500, 'SESSION_UNAVAILABLE')
    return mobileJson({
      apiVersion: 1,
      token,
      expiresAt: session.session.expiresAt,
      user: { id: session.user.id, name: session.user.name }
    })
  } catch (error) {
    if (!(error instanceof MobileError) && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
      return mobileJson({ error: { code: 'INVALID_CREDENTIALS' } }, 401)
    }
    return mobileError(error)
  }
}
export async function GET(request: Request) {
  return mobileRoute(request, async (id) => mobileJson({ apiVersion: 1, user: { id }, mediaPageSize: 24 }))
}
export async function DELETE(request: Request) {
  return mobileRoute(request, async () => {
    await mobileAuth.api.signOut({ headers: mobileAuthHeaders(request.headers) })
    return mobileJson({ ok: true })
  })
}
