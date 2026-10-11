/** JSON envelope; SSE events and explicitly documented legacy DTOs are separate contracts. */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data?: T
}

export interface CompatibleApiFailure<T = unknown> extends ApiResponse<T> {
  success: false
  errorCode: number
  error: string
  details?: string
}

export interface CompatibleApiSuccess<T> extends ApiResponse<T> {
  success: true
  errorCode: 0
}
