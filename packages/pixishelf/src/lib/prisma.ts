import { PrismaClient } from '@prisma/client'

// ============================================================================
// Prisma 客户端配置
// ============================================================================

/**
 * 全局 Prisma 客户端实例
 * 在开发环境中防止热重载时创建多个实例
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma 客户端实例
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'pretty'
  })

// 在开发环境中将实例保存到全局对象，避免热重载时重复创建
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * 数据库连接测试
 * @returns Promise<boolean> 连接是否成功
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$connect()
    console.log('✅ 数据库连接成功')
    return true
  } catch (error) {
    console.error('❌ 数据库连接失败:', error)
    return false
  }
}

/**
 * 优雅关闭数据库连接
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect()
    console.log('✅ 数据库连接已关闭')
  } catch (error) {
    console.error('❌ 关闭数据库连接时出错:', error)
  }
}

/**
 * 数据库健康检查
 * @returns Promise<{ isHealthy: boolean; latency?: number; error?: string }>
 */
export async function checkDatabaseHealth(): Promise<{
  isHealthy: boolean
  latency?: number
  error?: string
}> {
  try {
    const startTime = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const latency = Date.now() - startTime

    return {
      isHealthy: true,
      latency
    }
  } catch (error) {
    return {
      isHealthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * 执行数据库事务
 * @param callback - 事务回调函数
 * @returns Promise<T> 事务结果/**
 * 执行数据库事务
 */
export async function executeTransaction<T>(
  callback: (
    prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
  ) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(callback)
}

/**
 * 数据库错误处理
 * @param error - Prisma 错误
 * @returns 格式化的错误信息
 */
export function handlePrismaError(error: any): {
  message: string
  code?: string
  statusCode: number
} {
  // Prisma 已知错误代码
  if (error.code) {
    switch (error.code) {
      case 'P2002':
        return {
          message: '数据已存在，违反唯一约束',
          code: error.code,
          statusCode: 409
        }
      case 'P2025':
        return {
          message: '记录不存在',
          code: error.code,
          statusCode: 404
        }
      case 'P2003':
        return {
          message: '外键约束失败',
          code: error.code,
          statusCode: 400
        }
      case 'P2014':
        return {
          message: '数据关系冲突',
          code: error.code,
          statusCode: 400
        }
      default:
        return {
          message: `数据库错误: ${error.message}`,
          code: error.code,
          statusCode: 500
        }
    }
  }

  // 连接错误
  if (error.message?.includes('connect')) {
    return {
      message: '数据库连接失败',
      statusCode: 503
    }
  }

  // 超时错误
  if (error.message?.includes('timeout')) {
    return {
      message: '数据库操作超时',
      statusCode: 504
    }
  }

  // 默认错误
  return {
    message: error.message || '数据库操作失败',
    statusCode: 500
  }
}

// 注意：在Edge Runtime环境中，process事件监听器不可用
// 如果需要在Node.js环境中使用，请取消注释以下代码：
/*
if (typeof process !== 'undefined' && process.on) {
  // 进程退出时自动断开连接
  process.on('beforeExit', async () => {
    await disconnectDatabase()
  })

  process.on('SIGINT', async () => {
    await disconnectDatabase()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await disconnectDatabase()
    process.exit(0)
  })
}
*/
/**
 * 获取 Prisma 客户端实例
 * @returns PrismaClient 实例
 */
export function getPrisma(): PrismaClient {
  return prisma
}

// ============================================================================
// 管理员初始化
// ============================================================================

/**
 * 初始化管理员账户
 */
export async function initializeAdmin(): Promise<void> {
  try {
    const { hashPassword } = await import('./crypto')

    // 从环境变量获取管理员配置
    const adminUsername = process.env.ADMIN_USERNAME || 'admin'
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

    console.log('🔧 开始初始化管理员账户...')

    // 检查管理员是否已存在
    const existingAdmin = await prisma.user.findUnique({
      where: { username: adminUsername }
    })

    if (existingAdmin) {
      console.log('✅ 管理员账户已存在，跳过初始化')
      return
    }

    // 创建管理员账户
    const hashedPassword = await hashPassword(adminPassword)

    await prisma.user.create({
      data: {
        username: adminUsername,
        password: hashedPassword
      }
    })

    console.log(`✅ 管理员账户初始化完成: ${adminUsername}`)
  } catch (error) {
    console.error('❌ 管理员账户初始化失败:', error)
    throw error
  }
}
