import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/crypto'
import { AuthError } from '@/lib/auth'

/**
 * 查询所有用户
 * @returns Promise<User[]>
 */
export async function queryUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, createdAt: true },
    orderBy: { id: 'asc' }
  })
  return users
}

/**
 * 添加用户
 * @param username - 用户名
 * @param password - 密码
 * @returns Promise<User>
 */
export async function addUser(username: string, password: string) {
  // 检查用户名是否已存在
  const existingUser = await prisma.user.findUnique({ where: { username } })
  if (existingUser) {
    throw new Error('Username already exists')
  }

  // 加密密码
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(password, salt)

  // 创建用户
  const user = await prisma.user.create({
    data: { username, password: hashedPassword }
  })

  return user
}

/**
 * 删除用户
 * @param id - 用户ID
 * @returns Promise<void>
 */
export async function deleteUser(id: number) {
  // 检查是否是最后一个用户
  const totalUsers = await prisma.user.count()
  if (totalUsers <= 1) {
    throw new Error('Cannot delete the last user')
  }

  // 检查用户是否存在
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    throw new Error('User not found')
  }
  // 删除用户
  await prisma.user.delete({ where: { id } })
}

/**
 * 根据用户名查找用户
 * @param username - 用户名
 * @param password - 是否包含密码哈希，默认不包含. 如果设置为true, 你需要非常小心的处理
 * @returns Promise<User | null>
 */
export async function findByUsername(username: string) {
  const user = await prisma.user.findUnique({
    select: {
      id: true,
      username: true,
      createdAt: true,
      updatedAt: true
    },
    where: { username: username.trim() }
  })

  return user
}

/**
 * 验证用户凭据
 * @param username - 用户名
 * @param pwd - 密码
 * @returns Promise<User | null> 验证成功返回用户信息，失败返回null
 */
export async function validateCredentials(username: string, pwd: string) {
  try {
    // 查找用户
    const user = await prisma.user.findUnique({
      select: {
        id: true,
        username: true,
        createdAt: true,
        updatedAt: true,
        password: true
      },
      where: { username: username.trim() }
    })

    if (!user) {
      return null
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(pwd, user.password)

    if (!isPasswordValid) {
      return null
    }

    // 返回不包含密码哈希的用户对象
    const { password, ...safeUser } = user
    return safeUser
  } catch (error) {
    throw new AuthError(`凭据验证失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 修改用户密码
 * @param userId - 用户ID
 * @param currentPassword - 当前密码
 * @param newPassword - 新密码
 * @returns Promise<void>
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  try {
    // 获取当前用户信息
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new Error('用户不存在')
    }

    // 验证当前密码
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      throw new Error('当前密码不正确')
    }

    // 加密新密码
    const salt = await bcrypt.genSalt(10)
    const hashedNewPassword = await bcrypt.hash(newPassword, salt)

    // 更新密码
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword }
    })
  } catch (error) {
    throw new Error(`密码修改失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
