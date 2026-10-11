import type { ApiResponse } from '@/types/http-response'

/** Read JSON errors during the gradual migration from { error } to { code, message, data }. */
export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback
    const error = body as Partial<ApiResponse> & { error?: unknown }
    if (typeof error.message === 'string' && error.message.trim()) return error.message
    if (typeof error.error === 'string' && error.error.trim()) return error.error
  } catch {
    // A proxy or framework may return HTML or an empty body; don't expose that as a UI message.
  }
  return fallback
}
