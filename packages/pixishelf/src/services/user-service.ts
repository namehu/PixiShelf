import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/crypto'
import { AuthError } from '@/lib/auth'

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
