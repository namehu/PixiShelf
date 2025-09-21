import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { UsersResponse, CreateUserRequest, CreateUserResponse } from '@/types'
import { prisma } from '@/lib/prisma'

/**
 * 获取用户列表接口
 * GET /api/v1/users
 */
export async function GET(request: NextRequest): Promise<NextResponse<UsersResponse>> {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { id: 'asc' }
    })

    // 转换日期格式
    const formattedUsers = users.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString()
    }))

    const response: UsersResponse = { items: formattedUsers }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get users:', error)

    return NextResponse.json({ error: 'Failed to get users' } as any, { status: 500 })
  }
}

/**
 * 创建用户接口
 * POST /api/v1/users
 */
export async function POST(request: NextRequest): Promise<NextResponse<CreateUserResponse>> {
  try {
    const body = (await request.json()) as CreateUserRequest
    const username = (body?.username || '').trim()
    const password = body?.password || ''

    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' } as any, { status: 400 })
    }

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({ where: { username } })
    if (existingUser) {
      return NextResponse.json({ error: 'Username already exists' } as any, { status: 409 })
    }

    // 加密密码
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // 创建用户
    const user = await prisma.user.create({
      data: { username, password: hashedPassword }
    })

    const response: CreateUserResponse = {
      id: user.id,
      username: user.username
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to create user:', error)

    return NextResponse.json({ error: 'Failed to create user' } as any, { status: 500 })
  }
}
