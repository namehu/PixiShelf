import { bigintStringSchema } from '@pixishelf/job-contracts'
import { ApiError } from '@/lib/api-handler'
import { PostgresJobEventStreamSource } from '@/services/background-task/job-event-stream-service'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { createJobEventStreamResponse } from './stream-response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequest(request)
  } catch (error) {
    if (error instanceof ApiError || isApiError(error)) {
      return Response.json({ error: error.message }, { status: error.statusCode })
    }
    throw error
  }

  const url = new URL(request.url)
  const requestedCursor = url.searchParams.get('afterEventId') ?? request.headers.get('last-event-id')
  if (requestedCursor !== null && !bigintStringSchema.safeParse(requestedCursor).success) {
    return Response.json({ error: 'Invalid event cursor' }, { status: 400 })
  }

  return createJobEventStreamResponse(request, new PostgresJobEventStreamSource(), requestedCursor)
}

function isApiError(error: unknown): error is { message: string; statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  )
}
