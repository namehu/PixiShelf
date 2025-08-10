import { FastifyInstance } from 'fastify'

export async function authPlugin(server: FastifyInstance) {
  server.addHook('preHandler', async (req, reply) => {
    // always allow image serving without API key
    if (typeof req.url === 'string' && req.url.startsWith('/api/v1/images/')) return

    const openPaths = [
      { method: 'GET', url: '/api/v1/health' },
    ] as const
    const isOpen = openPaths.some((p) => {
      if (p.method !== req.method) return false
      if (typeof p.url === 'string') return p.url === req.url
      return (p.url as any).test ? (p.url as any).test(req.url) : false
    })
    if (isOpen) return

    const apiKey = process.env.API_KEY
    const header = req.headers['authorization'] || req.headers['x-api-key']
    let token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : typeof header === 'string' ? header : undefined
    if (!token) {
      const q: any = (req as any).query || {}
      token = q.apiKey || q.token
    }

    if (!apiKey || token !== apiKey) {
      reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' })
    }
  })
}