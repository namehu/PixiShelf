import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { UsersResponse, CreateUserRequest, CreateUserResponse, ChangePasswordRequest, ChangePasswordResponse } from '@pixishelf/shared'
import { asApiResponse } from '../types/response'

export default async function usersRoutes(server: FastifyInstance) {
  // List users (simple list for admin UI)
  server.get('/api/v1/users', async (): Promise<UsersResponse> => {
    const users = await server.prisma.user.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { id: 'asc' }
    })
    
    // 使用类型转换辅助函数，实际转换由插件处理
    return { items: asApiResponse(users) }
  })

  // Create user (admin-only)
  server.post('/api/v1/users', async (req, reply) => {
    const body = req.body as CreateUserRequest
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
    const response: CreateUserResponse = { id: user.id, username: user.username }
    return response
  })

  // Delete user (allow deleting any user, but prevent deleting the last user; prevent self deletion to avoid killing current session)
  server.delete('/api/v1/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = Number(id)
    if (!Number.isFinite(userId)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid user ID' })
    }

    const currentUser = (req as any).user
    if (currentUser?.id === userId) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Cannot delete yourself' })
    }

    const totalUsers = await server.prisma.user.count()
    if (totalUsers <= 1) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Cannot delete the last user' })
    }

    const user = await server.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }

    await server.prisma.user.delete({ where: { id: userId } })
    return { success: true }
  })

  // Change password (user can only change their own password)
  server.put('/api/v1/users/password', async (req, reply) => {
    const body = req.body as ChangePasswordRequest
    const currentPassword = body?.currentPassword || ''
    const newPassword = body?.newPassword || ''
    
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'currentPassword and newPassword are required' })
    }

    const currentUser = (req as any).user
    if (!currentUser?.id) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'User not authenticated' })
    }

    // Get current user from database
    const user = await server.prisma.user.findUnique({ where: { id: currentUser.id } })
    if (!user) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: '当前密码不正确' })
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10)
    const hashedNewPassword = await bcrypt.hash(newPassword, salt)

    // Update password in database
    await server.prisma.user.update({
      where: { id: currentUser.id },
      data: { password: hashedNewPassword }
    })

    const response: ChangePasswordResponse = {
      success: true,
      message: '密码修改成功'
    }
    return response
  })
}