'use client'

import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserPlus, Trash2, User as UserIcon } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { toast } from 'sonner'
import { confirm } from '@/components/shared/global-confirm'

function UserManagement() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery(trpc.user.queryUsers.queryOptions())

  const deleteUser = useMutation(
    trpc.user.deleteUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.queryUsers.queryKey() })
      }
    })
  )

  const createUser = useMutation(
    trpc.user.addUser.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.queryUsers.queryKey() })
      }
    })
  )

  const [showForm, setShowForm] = React.useState(false)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    try {
      await createUser.mutateAsync({ username: username.trim(), password })
      setUsername('')
      setPassword('')
      setShowForm(false)
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  // 处理删除用户
  const handleDelete = (id: string) => {
    confirm({
      title: '确认删除用户？',
      description: '此操作将永久删除该用户账户。此操作不可撤销。',
      variant: 'destructive',
      confirmText: '确认删除',
      onConfirm: async () => {
        try {
          await deleteUser.mutateAsync(id)
        } catch (error: any) {
          toast.error(error.message)
        }
      }
    })
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页面标题和操作区域 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 mb-2">用户管理</h1>
            <p className="text-neutral-600">管理系统用户账户、权限和访问控制</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="sm:w-auto">
            <UserPlus className="mr-2 h-4 w-4" />
            {showForm ? '取消' : '添加用户'}
          </Button>
        </div>

        {/* 添加用户表单 */}
        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>添加新用户</CardTitle>
              <CardDescription>创建新的用户账户</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">用户名</label>
                  <Input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">密码</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={createUser.isPending || !username.trim() || !password.trim()}>
                    {createUser.isPending ? '创建中...' : '创建用户'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false)
                      setUsername('')
                      setPassword('')
                    }}
                  >
                    取消
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* 用户列表 */}
        <Card>
          <CardHeader>
            <CardTitle>用户列表</CardTitle>
            <CardDescription>查看和管理所有系统用户</CardDescription>
          </CardHeader>
          <CardContent>
            {/* 加载状态 */}
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                  <p className="text-muted-foreground">加载中...</p>
                </div>
              </div>
            )}

            {/* 错误状态 */}
            {isError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
                <div className="text-destructive font-medium">加载失败</div>
                <div className="text-destructive/80 text-sm mt-1">无法获取用户列表，请稍后重试</div>
              </div>
            )}

            {/* 用户列表 */}
            {data && (
              <>
                {data.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <UserIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">暂无用户</h3>
                    <p className="text-muted-foreground mb-4">还没有创建任何用户账户</p>
                    <Button onClick={() => setShowForm(true)}>添加第一个用户</Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>用户</TableHead>
                          <TableHead>创建时间</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="text-muted-foreground">{user.id}</TableCell>
                            <TableCell>
                              <div className="flex items-center space-x-3 font-medium">{user.username}</div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(user.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(user.id)}
                                disabled={deleteUser.isPending}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                {deleteUser.isPending ? '删除中...' : '删除'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* 用户统计 */}
                {data.length > 0 && (
                  <div className="mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground text-center">共 {data.length} 个用户账户</div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default UserManagement
