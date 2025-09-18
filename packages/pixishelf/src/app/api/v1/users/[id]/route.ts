import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'

/**
 * 删除用户接口
 * DELETE /api/v1/users/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // 验证认证
    const authResult = await verifyAuth(request)
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const userId = Number(id)
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    // 防止删除自己
    if (authResult.user && Number(authResult.user.id) === userId) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })
    }

    // 检查是否是最后一个用户
    const totalUsers = await prisma.user.count()
    if (totalUsers <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last user' }, { status: 400 })
    }

    // 检查用户是否存在
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // 删除用户
    await prisma.user.delete({ where: { id: userId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete user:', error)

    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
