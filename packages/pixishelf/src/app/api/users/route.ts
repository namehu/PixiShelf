import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { apiHandler } from '@/lib/api-handler'
import { GetUsersSchema, CreateUserSchema } from '@/schemas/users.dto'
import { ApiError } from '@/lib/errors'

/**
 * 获取用户列表接口
 * GET /api/users
 */
export const GET = apiHandler(GetUsersSchema, async () => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, createdAt: true },
    orderBy: { id: 'asc' }
  })

  return { items: users }
})

/**
 * 创建用户接口
 * POST /api/users
 */
export const POST = apiHandler(CreateUserSchema, async (request, data) => {
  const { username, password } = data

  // 检查用户名是否已存在
  const existingUser = await prisma.user.findUnique({ where: { username } })
  if (existingUser) {
    throw new ApiError('Username already exists', 409)
  }

  // 加密密码
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(password, salt)

  // 创建用户
  const user = await prisma.user.create({
    data: { username, password: hashedPassword }
  })

  return {
    id: user.id
  }
})
