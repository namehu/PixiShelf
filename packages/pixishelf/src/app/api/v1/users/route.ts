import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { apiHandler } from '@/lib/api-handler'
import { GetUsersSchema, CreateUserSchema } from '@/schemas/api/user'
import { ApiError } from '@/lib/errors'

// ============================================================================
// 用户列表与创建 API 路由
// ============================================================================

/**
 * 获取用户列表接口
 * GET /api/v1/users
 */
export const GET = apiHandler(GetUsersSchema, async () => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, createdAt: true },
    orderBy: { id: 'asc' }
  })

  // 转换日期格式
  const formattedUsers = users.map((user) => ({
    ...user
  }))

  return { items: formattedUsers }
})

/**
 * 创建用户接口
 * POST /api/v1/users
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
    id: user.id,
    username: user.username
  }
})
