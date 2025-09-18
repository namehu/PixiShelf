import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { ChangePasswordRequest, ChangePasswordResponse } from '@pixishelf/shared'
import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'

/**
 * 修改密码接口
 * PUT /api/v1/users/password
 */
export async function PUT(request: NextRequest): Promise<NextResponse<ChangePasswordResponse>> {
  try {
    // 验证认证
    const authResult = await verifyAuth(request)
    if (!authResult.success || !authResult.user) {
      return NextResponse.json({ success: false, message: 'User not authenticated' } as any, { status: 401 })
    }

    const body = (await request.json()) as ChangePasswordRequest
    const currentPassword = body?.currentPassword || ''
    const newPassword = body?.newPassword || ''

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ success: false, message: 'currentPassword and newPassword are required' } as any, {
        status: 400
      })
    }

    // 获取当前用户信息
    const user = await prisma.user.findUnique({ where: { id: Number(authResult.user.id) } })
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' } as any, { status: 404 })
    }

    // 验证当前密码
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      return NextResponse.json({ success: false, message: '当前密码不正确' } as any, { status: 400 })
    }

    // 加密新密码
    const salt = await bcrypt.genSalt(10)
    const hashedNewPassword = await bcrypt.hash(newPassword, salt)

    // 更新密码
    await prisma.user.update({
      where: { id: Number(authResult.user.id) },
      data: { password: hashedNewPassword }
    })

    const response: ChangePasswordResponse = {
      success: true,
      message: '密码修改成功'
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to change password:', error)

    return NextResponse.json({ success: false, message: 'Failed to change password' } as any, { status: 500 })
  }
}
