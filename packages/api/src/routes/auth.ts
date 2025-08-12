import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { LoginRequest, LoginResponse } from '@pixishelf/shared'

export default async function authRoutes(server: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
  const TOKEN_TTL_SECONDS = parseInt(process.env.JWT_TTL || '86400', 10) // default 1 day

  // Remove public register. Admin-only create user will live under /api/v1/users (protected)

  // Login
  server.post('/api/v1/auth/login', async (req, reply) => {
    const body = req.body as LoginRequest
    const username = (body?.username || '').trim()
    const password = body?.password || ''
    if (!username || !password) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'username and password are required' })
    }

    const user = await server.prisma.user.findUnique({ where: { username } })
    if (!user) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid username or password' })
    }

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid username or password' })
    }

    const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS })
    const response: LoginResponse = { token, user: { id: user.id, username: user.username } }
    return response
  })
}