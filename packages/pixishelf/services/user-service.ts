import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'

/**
 * 查询所有用户
 * @returns Promise<User[]>
 */
export async function queryUsers() {
  const users = await prisma.userBA.findMany({
    orderBy: { createdAt: 'desc' }
  })

  // 适配 DTO，将 name 映射为 username (如果 name 存在)
  return users.map((user) => ({
    ...user,
    username: user.name
    // 确保 id 是 string (UserBA id 已经是 string)
  }))
}

/**
 * 添加用户
 * @param username - 用户名
 * @param password - 密码
 * @returns Promise<User>
 */
export async function addUser(username: string, password: string) {
  // 检查用户名是否已存在 (检查 email 或 name)
  const existingUser = await prisma.userBA.findFirst({
    where: {
      OR: [{ email: `${username}@pixishelf.local` }, { name: username }]
    }
  })

  if (existingUser) {
    throw new Error('Username already exists')
  }

  try {
    // 使用 Better-Auth API 创建用户
    const result = await auth.api.signUpEmail({
      body: {
        email: `${username}@pixishelf.local`,
        password,
        name: username
      }
    })

    if (!result?.user) {
      throw new Error('Failed to create user')
    }

    return {
      ...result.user,
      username: result.user.name
    }
  } catch (error) {
    console.error('Create user error:', error)
    throw new Error('Failed to create user')
  }
}

/**
 * 删除用户
 * @param id - 用户ID
 * @returns Promise<void>
 */
export async function deleteUser(id: string) {
  // 检查是否是最后一个用户
  const totalUsers = await prisma.userBA.count()
  if (totalUsers <= 1) {
    throw new Error('Cannot delete the last user')
  }

  // 检查用户是否存在
  const user = await prisma.userBA.findUnique({ where: { id } })
  if (!user) {
    throw new Error('User not found')
  }

  // 删除用户
  await prisma.userBA.delete({ where: { id } })
}

/**
 * 根据用户名查找用户
 * @param username - 用户名
 * @returns Promise<User | null>
 */
export async function findByUsername(username: string) {
  const user = await prisma.userBA.findFirst({
    where: {
      OR: [{ name: username }, { email: `${username}@pixishelf.local` }]
    }
  })

  if (!user) return null

  return {
    ...user,
    username: user.name
  }
}

// 注意：validateCredentials 和 changePassword 已被移除，应使用 Better-Auth 的 API
