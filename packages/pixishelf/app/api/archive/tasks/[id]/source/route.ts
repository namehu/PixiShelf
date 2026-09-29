import { ApiError } from '@/lib/api-handler'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { getArchiveTaskSourceUrl } from '@/services/archive/archive-task-source-service'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireAdminRequest(request)
  } catch (error) {
    const status = error instanceof ApiError && error.statusCode === 401 ? 401 : 500
    return Response.json(
      { error: status === 401 ? 'Unauthorized' : '无法读取任务原站' },
      {
        status,
        headers: privateHeaders
      }
    )
  }

  const { id } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return Response.json({ error: '任务标识无效' }, { status: 400, headers: privateHeaders })
  }
  try {
    const sourceUrl = await getArchiveTaskSourceUrl(id)
    if (!sourceUrl) {
      return Response.json({ error: '任务原站不可用' }, { status: 404, headers: privateHeaders })
    }
    return new Response(null, { status: 302, headers: { ...privateHeaders, Location: sourceUrl } })
  } catch {
    // Database errors can contain the private locator; never echo or log them here.
    return Response.json({ error: '无法读取任务原站' }, { status: 500, headers: privateHeaders })
  }
}
