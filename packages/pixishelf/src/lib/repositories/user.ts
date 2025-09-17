import { prisma, handlePrismaError } from '../prisma'
import type { User, PrismaUser } from '@/types/core'
import type { CreateUserRequest } from '@/types/auth'

// ============================================================================
// 用户数据仓储
// ============================================================================

/**
 * 用户仓储接口
 */
export interface IUserRepository {
  findById(id: number): Promise<User | null>
  findByUsername(username: string): Promise<User | null>
  create(userData: CreateUserRequest): Promise<User>
  update(id: number, userData: Partial<Omit<User, 'id'>>): Promise<User | null>
  delete(id: number): Promise<void>
  exists(username: string): Promise<boolean>
  count(): Promise<number>
  list(options?: { skip?: number; take?: number }): Promise<User[]>
  updatePassword(id: number, hashedPassword: string): Promise<void>
}

/**
 * 用户仓储实现
 */
export class UserRepository implements IUserRepository {
  /**
   * 将Prisma用户转换为应用用户类型
   */
  private convertPrismaUserToUser(prismaUser: PrismaUser): User {
    return {
      id: prismaUser.id.toString(),
      username: prismaUser.username,
      passwordHash: prismaUser.password,
      createdAt: prismaUser.createdAt.toISOString(),
      updatedAt: prismaUser.updatedAt.toISOString()
    }
  }

  /**
   * 根据ID查找用户
   * @param id - 用户ID
   * @returns Promise<User | null>
   */
  async findById(id: number): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id }
      })
      if (!user) {
        return null
      }

      return this.convertPrismaUserToUser(user)
    } catch (error) {
      const { message, statusCode } = handlePrismaError(error)
      throw new Error(`查找用户失败: ${message}`)
    }
  }

  /**
   * 根据用户名查找用户
   * @param username - 用户名
   * @returns Promise<User | null>
   */
  async findByUsername(username: string): Promise<User | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { username: username.trim() }
      })
      if (!user) {
        return null
      }

      return this.convertPrismaUserToUser(user)
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`查找用户失败: ${message}`)
    }
  }

  /**
   * 创建新用户
   * @param userData - 用户数据
   * @returns Promise<User>
   */
  async create(userData: CreateUserRequest): Promise<User> {
    try {
      const newUser = await prisma.user.create({
        data: {
          username: userData.username,
          password: userData.passwordHash
        }
      })
      return this.convertPrismaUserToUser(newUser)
    } catch (error) {
      const { message, code, statusCode } = handlePrismaError(error)

      // 处理用户名重复错误
      if (code === 'P2002') {
        throw new Error('用户名已存在')
      }

      throw new Error(`创建用户失败: ${message}`)
    }
  }

  /**
   * 更新用户信息
   * @param id - 用户ID
   * @param userData - 更新数据
   * @returns Promise<User | null>
   */
  async update(id: number, userData: Partial<Omit<User, 'id'>>): Promise<User | null> {
    try {
      const user = await prisma.user.update({
        where: { id },
        data: {
          ...(userData.username && { username: userData.username }),
          updatedAt: new Date()
        }
      })
      if (!user) {
        return null
      }

      return this.convertPrismaUserToUser(user)
    } catch (error) {
      const { message, code } = handlePrismaError(error)

      if (code === 'P2025') {
        throw new Error('用户不存在')
      }

      if (code === 'P2002') {
        throw new Error('用户名已存在')
      }

      throw new Error(`更新用户失败: ${message}`)
    }
  }

  /**
   * 删除用户
   * @param id - 用户ID
   * @returns Promise<void>
   */
  async delete(id: number): Promise<void> {
    try {
      await prisma.user.delete({
        where: { id }
      })
    } catch (error) {
      const { message, code } = handlePrismaError(error)

      if (code === 'P2025') {
        throw new Error('用户不存在')
      }

      throw new Error(`删除用户失败: ${message}`)
    }
  }

  /**
   * 检查用户名是否存在
   * @param username - 用户名
   * @returns Promise<boolean>
   */
  async exists(username: string): Promise<boolean> {
    try {
      const count = await prisma.user.count({
        where: { username: username.trim() }
      })
      return count > 0
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`检查用户存在性失败: ${message}`)
    }
  }

  /**
   * 获取用户总数
   * @returns Promise<number>
   */
  async count(): Promise<number> {
    try {
      return await prisma.user.count()
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`获取用户总数失败: ${message}`)
    }
  }

  /**
   * 获取用户列表
   * @param options - 查询选项
   * @returns Promise<User[]>
   */
  async list(options: { skip?: number; take?: number } = {}): Promise<User[]> {
    try {
      const { skip = 0, take = 20 } = options

      const users = await prisma.user.findMany({
        skip,
        take,
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          // 不返回密码字段
          password: false
        }
      })

      return users.map((user) => ({
        id: user.id.toString(),
        username: user.username,
        passwordHash: '', // 不返回密码
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }))
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`获取用户列表失败: ${message}`)
    }
  }

  /**
   * 更新用户密码
   * @param id - 用户ID
   * @param hashedPassword - 加密后的密码
   * @returns Promise<void>
   */
  async updatePassword(id: number, hashedPassword: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id },
        data: {
          password: hashedPassword,
          updatedAt: new Date()
        }
      })
    } catch (error) {
      const { message, code } = handlePrismaError(error)

      if (code === 'P2025') {
        throw new Error('用户不存在')
      }

      throw new Error(`更新密码失败: ${message}`)
    }
  }

  /**
   * 获取用户的安全信息（不包含密码）
   * @param id - 用户ID
   * @returns Promise<Omit<User, 'passwordHash'> | null>
   */
  async findSafeById(id: number): Promise<Omit<User, 'passwordHash'> | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          username: true,
          createdAt: true,
          updatedAt: true
        }
      })

      if (!user) {
        return null
      }

      return {
        id: user.id.toString(),
        username: user.username,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`查找用户失败: ${message}`)
    }
  }

  /**
   * 批量创建用户（用于测试或数据迁移）
   * @param usersData - 用户数据数组
   * @returns Promise<User[]>
   */
  async createMany(usersData: CreateUserRequest[]): Promise<User[]> {
    try {
      const result = await prisma.$transaction(
        usersData.map((userData) =>
          prisma.user.create({
            data: {
              username: userData.username,
              password: userData.passwordHash
            }
          })
        )
      )
      return result.map((user) => this.convertPrismaUserToUser(user))
    } catch (error) {
      const { message } = handlePrismaError(error)
      throw new Error(`批量创建用户失败: ${message}`)
    }
  }
}

// 导出单例实例
export const userRepository = new UserRepository()
