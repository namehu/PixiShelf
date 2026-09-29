import { ApiError } from '@/lib/api-handler'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { getArchivePreviewSourceUrl } from '@/services/archive-preview/archive-preview-service'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let userId: string
  try {
    const auth = await requireAdminRequest(request)
    userId = auth.userId
  } catch (error) {
    const status = error instanceof ApiError && error.statusCode === 401 ? 401 : 500
    return Response.json(
      { error: status === 401 ? 'Unauthorized' : '无法打开预览原站' },
      { status, headers: privateHeaders }
    )
  }

  const { id } = await context.params
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) {
    return Response.json({ error: '预览标识无效' }, { status: 400, headers: privateHeaders })
  }
  try {
    const sourceUrl = getArchivePreviewSourceUrl(id, userId)
    if (!sourceUrl) {
      return Response.json({ error: '预览会话不存在或已过期' }, { status: 404, headers: privateHeaders })
    }
    return new Response(null, { status: 302, headers: { ...privateHeaders, Location: sourceUrl } })
  } catch {
    // Preview sessions contain private gallery locators; never echo or log redirect failures.
    return Response.json({ error: '无法打开预览原站' }, { status: 500, headers: privateHeaders })
  }
}
