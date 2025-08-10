import { FastifyInstance } from 'fastify'
import jwt, { JwtPayload } from 'jsonwebtoken'

export async function authPlugin(server: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

  server.addHook('preHandler', async (req, reply) => {
    const url = typeof req.url === 'string' ? req.url : ''

    // Public endpoints: login and image serving
    const openPaths = [
      { method: 'POST', url: '/api/v1/auth/login' },
    ] as const

    // Check for exact match first
    const isOpen = openPaths.some((p) => p.method === req.method && p.url === url)
    if (isOpen) return

    // Allow all image requests (GET /api/v1/images/*)
    if (req.method === 'GET' && url.startsWith('/api/v1/images/')) return

    // Extract token from Authorization header or query parameter (for SSE)
    const header = req.headers['authorization']
    let token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : undefined

    // For SSE endpoints, allow token via query parameter
    if (!token && req.method === 'GET' && url.includes('/api/v1/scan/stream')) {
      const queryToken = req.query && typeof req.query === 'object' && (req.query as any).token
      if (typeof queryToken === 'string') {
        token = queryToken
      }
    }

    if (!token) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing Authorization header' })
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      const payload = typeof decoded === 'string' ? null : (decoded as JwtPayload)
      const sub = payload?.sub
      const username = (payload as any)?.username
      if (typeof sub !== 'string' && typeof sub !== 'number' || !username) {
        throw new Error('Invalid token payload')
      }
      ;(req as any).user = { id: Number(sub), username: String(username) }
    } catch (err) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  })
}