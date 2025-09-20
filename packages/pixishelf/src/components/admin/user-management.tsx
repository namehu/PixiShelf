'use client'

import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { UsersResponse } from '@pixishelf/shared'
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui'
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui'
import { Input } from '@/components/ui'
import { Avatar, AvatarFallback } from '@/components/ui'
import { UserPlus, Trash2, User as UserIcon } from 'lucide-react'

// Hook: 获取用户列表
function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<UsersResponse> => {
      return apiJson<UsersResponse>('/api/v1/users')
    }
  })
}

// Hook: 删除用户
function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      return apiJson(`/api/v1/users/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}

// Hook: 创建用户
function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      return apiJson('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}

/**
 * 用户管理组件
 * 
 * 功能：
 * - 用户列表展示和管理
 * - 添加新用户账户
 * - 删除用户账户
 * - 表单验证和错误处理
 * 
 * 迁移自原Users.tsx，保持所有功能不变
 */
function UserManagement() {
  const { data, isLoading, isError } = useUsers()
  const deleteUser = useDeleteUser()
  const createUser = useCreateUser()
  const [showForm, setShowForm] = React.useState(false)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [userToDelete, setUserToDelete] = React.useState<number | null>(null)

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    
    try {
      await createUser.mutateAsync({ username: username.trim(), password })
      setUsername('')
      setPassword('')
      setShowForm(false)
    } catch (error) {
      console.error('Failed to create user:', error)
    }
  }

  // 处理删除用户
  const handleDelete = (id: number) => {
    setUserToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (userToDelete === null) return
    
    try {
      await deleteUser.mutateAsync(userToDelete)
      setDeleteDialogOpen(false)
      setUserToDelete(null)
    } catch (error) {
      console.error('Failed to delete user:', error)
    }
  }

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase()
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作区域 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground">
            管理系统用户账户、权限和访问控制
          </p>
        </div>
        <Button 
          onClick={() => setShowForm(!showForm)}
          className="sm:w-auto"
        >
          <UserPlus className="mr-2 h-4 w-4" />
          {showForm ? '取消' : '添加用户'}
        </Button>
      </div>

      {/* 添加用户表单 */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>添加新用户</CardTitle>
            <CardDescription>
              创建新的用户账户
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  用户名
                </label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  密码
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  required
                />
              </div>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={createUser.isPending || !username.trim() || !password.trim()}
                >
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
          <CardDescription>
            查看和管理所有系统用户
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 加载状态 */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
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
              {data.items.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <UserIcon className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">暂无用户</h3>
                  <p className="text-muted-foreground mb-4">还没有创建任何用户账户</p>
                  <Button onClick={() => setShowForm(true)}>
                    添加第一个用户
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>用户</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-primary/10 text-primary font-medium">
                                  {getInitials(user.username)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="font-medium">{user.username}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.id}
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
              {data.items.length > 0 && (
                <div className="mt-6 pt-4 border-t">
                  <div className="text-sm text-muted-foreground text-center">
                    共 {data.items.length} 个用户账户
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除用户</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除这个用户吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default UserManagement