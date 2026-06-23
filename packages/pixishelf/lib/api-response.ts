import { NextResponse } from 'next/server'

export type ApiSuccessResponse<TBody extends Record<string, unknown> = Record<string, never>> = {
  success: true
} & TBody

export type ApiErrorResponse<TDetails = unknown> = {
  error: string
  details?: TDetails
}

export function apiSuccess<TBody extends Record<string, unknown> = Record<string, never>>(
  body?: TBody,
  init?: ResponseInit
) {
  return NextResponse.json<ApiSuccessResponse<TBody>>(
    {
      success: true,
      ...(body ?? ({} as TBody))
    },
    init
  )
}

export function apiError<TDetails = unknown>(message: string, options: { status?: number; details?: TDetails } = {}) {
  const body: ApiErrorResponse<TDetails> =
    options.details === undefined
      ? { error: message }
      : {
          error: message,
          details: options.details
        }

  return NextResponse.json<ApiErrorResponse<TDetails>>(body, { status: options.status ?? 500 })
}

export function apiJson<TBody>(body: TBody, init?: ResponseInit) {
  return NextResponse.json<TBody>(body, init)
}
