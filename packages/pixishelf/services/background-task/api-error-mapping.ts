import { ApiError } from '@/lib/api-handler'
import { classifyBackgroundTaskTransportError } from './transport-error'

export async function runBackgroundTaskApi<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const classified = classifyBackgroundTaskTransportError(error)
    if (classified) throw new ApiError(classified.message, classified.status)
    throw error
  }
}
