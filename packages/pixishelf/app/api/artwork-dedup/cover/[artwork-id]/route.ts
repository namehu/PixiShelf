import { auth } from '@/lib/auth'
import { openArtworkDedupCover } from '@/services/artwork-dedup-cover'
export const dynamic = 'force-dynamic'
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
}
const unavailable = (status: number) => Response.json({ error: '封面不可用' }, { status, headers: privateHeaders })
export async function GET(request: Request, context: { params: Promise<{ 'artwork-id': string }> }): Promise<Response> {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) return unavailable(401)
    const expectedUserId = new URL(request.url).searchParams.get('expectedUserId')
    if (!expectedUserId) return unavailable(400)
    if (expectedUserId !== session.user.id) return unavailable(403)
    const { 'artwork-id': id } = await context.params
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return unavailable(400)
    const cover = await openArtworkDedupCover(Number(id))
    return cover
      ? new Response(cover.body, {
          headers: { ...privateHeaders, 'Content-Type': cover.contentType, 'Content-Length': String(cover.size) }
        })
      : unavailable(404)
  } catch {
    return unavailable(500)
  }
}
