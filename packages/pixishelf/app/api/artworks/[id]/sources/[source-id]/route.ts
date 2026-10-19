import { auth } from '@/lib/auth'
import { getArtworkSourceUrl } from '@/services/artwork/source-links'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
const unavailable = (status: number) => Response.json({ error: '来源地址不可用' }, { status, headers: privateHeaders })

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; 'source-id': string }> }
): Promise<Response> {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) return unavailable(401)

    const { id, 'source-id': sourceId } = await context.params
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceId)) {
      return unavailable(400)
    }
    const sourceUrl = await getArtworkSourceUrl(Number(id), sourceId)
    if (!sourceUrl) return unavailable(404)
    return new Response(null, { status: 302, headers: { ...privateHeaders, Location: sourceUrl } })
  } catch {
    // Session and database exceptions may contain private locators.
    return unavailable(500)
  }
}
