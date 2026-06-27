import 'server-only'

import { runSchedulerTick } from '@/services/scheduled-task-service'
import logger from '@/lib/logger'
import { apiFailure, apiSuccess } from '@/lib/api-response'

function validateInternalJobAuth(req: Request) {
  const expectedToken = process.env.INTERNAL_JOB_TOKEN
  const authHeader = req.headers.get('Authorization')

  if (!expectedToken) {
    logger.warn('Scheduler tick attempted but INTERNAL_JOB_TOKEN is not set')
    return apiFailure('Internal scheduler is not configured (INTERNAL_JOB_TOKEN missing)', { status: 503 })
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return apiFailure('Unauthorized', { status: 401 })
  }

  return null
}

export async function POST(req: Request) {
  const authError = validateInternalJobAuth(req)
  if (authError) return authError

  try {
    const result = await runSchedulerTick()
    return apiSuccess({ data: result })
  } catch (error) {
    logger.error('Scheduler tick failed', { error })
    return apiFailure(error instanceof Error ? error.message : 'Unknown scheduler error')
  }
}

export async function GET(req: Request) {
  const authError = validateInternalJobAuth(req)
  if (authError) return authError

  return apiSuccess({ data: { status: 'ok' } })
}
