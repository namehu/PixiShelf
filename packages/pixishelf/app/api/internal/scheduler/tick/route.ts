import 'server-only'

import { NextResponse } from 'next/server'
import { runSchedulerTick } from '@/services/scheduled-task-service'
import logger from '@/lib/logger'

function validateInternalJobAuth(req: Request) {
  const expectedToken = process.env.INTERNAL_JOB_TOKEN
  const authHeader = req.headers.get('Authorization')

  if (!expectedToken) {
    logger.warn('Scheduler tick attempted but INTERNAL_JOB_TOKEN is not set')
    return NextResponse.json(
      { success: false, error: 'Internal scheduler is not configured (INTERNAL_JOB_TOKEN missing)' },
      { status: 503 }
    )
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

export async function POST(req: Request) {
  const authError = validateInternalJobAuth(req)
  if (authError) return authError

  try {
    const result = await runSchedulerTick()
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    logger.error('Scheduler tick failed', { error })
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown scheduler error'
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  const authError = validateInternalJobAuth(req)
  if (authError) return authError

  return NextResponse.json({ success: true, data: { status: 'ok' } })
}
