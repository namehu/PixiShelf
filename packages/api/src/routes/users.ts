import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'

export default async function usersRoutes(server: FastifyInstance) {
  // List users (simple list for admin UI)
  server.get('/api/v1/users', async () => {
    const users = await server.prisma.user.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { id: 'asc' }
    })
    return { items: users }
  })

  // Create user (admin-only)
  server.post('/api/v1/users', async (req, reply) => {
    const body = req.body as { username?: string; password?: string }
    const username = (body?.username || '').trim()
    const password = body?.password || ''
    if (!username || !password) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'username and password are required' })
    }

    const exist = await server.prisma.user.findUnique({ where: { username } })
    if (exist) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Username already exists' })
    }

    const salt = await bcrypt.genSalt(10)
    const hash = await bcrypt.hash(password, salt)

    const user = await server.prisma.user.create({ data: { username, password: hash } })
    return { id: user.id, username: user.username }
  })

  // Delete user (allow deleting any user, but prevent deleting the last user; prevent self deletion to avoid killing current session)
  server.delete('/api/v1/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = Number(id)
    if (!Number.isFinite(userId)) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'invalid id' })

    // prevent deleting the last remaining user
    const total = await server.prisma.user.count()
    if (total <= 1) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'cannot delete last user' })

    // prevent deleting current logged-in user to avoid accidental lockout
    const current = (req as any).user as { id: number; username: string }
    if (current && current.id === userId) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'cannot delete the currently logged-in user' })
    }

    try {
      await server.prisma.user.delete({ where: { id: userId } })
      return { success: true }
    } catch (e) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'user not found' })
    }
  })
}