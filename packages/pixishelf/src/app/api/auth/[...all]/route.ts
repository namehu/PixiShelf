import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { checkRateLimit } from '@/lib/rate-limit-server'
import { NextRequest, NextResponse } from 'next/server'

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth)

export async function POST(request: NextRequest) {
  if (!(await checkRateLimit(10, 'auth-api'))) {
    return new NextResponse('Too many requests', { status: 429 })
  }
  return authPOST(request)
}

export { authGET as GET }
