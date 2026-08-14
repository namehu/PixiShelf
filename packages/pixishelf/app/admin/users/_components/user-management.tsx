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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { PageState } from '@/components/layout/page-state'
import { AdminTableFrame } from '../../_components/admin-workbench'

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
  const [formError, setFormError] = React.useState<string | null>(null)
  const usernameRef = React.useRef<HTMLInputElement>(null)

  // 处理表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    setFormError(null)

    try {
      await createUser.mutateAsync({ username: username.trim(), password })
      setUsername('')
      setPassword('')
      setShowForm(false)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : '用户创建失败，请检查输入后重试。'
      setFormError(message)
      usernameRef.current?.focus()
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
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex justify-end">
          <Button onClick={() => setShowForm(!showForm)} className="sm:w-auto">
            <UserPlus data-icon="inline-start" aria-hidden="true" />
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
              <form onSubmit={handleSubmit}>
                <FieldGroup className="gap-4">
                  <Field data-invalid={Boolean(formError)}>
                    <FieldLabel htmlFor="admin-new-username">用户名</FieldLabel>
                    <Input
                      ref={usernameRef}
                      id="admin-new-username"
                      name="username"
                      type="text"
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value)
                        setFormError(null)
                      }}
                      placeholder="请输入用户名"
                      required
                      autoComplete="username"
                      spellCheck={false}
                      aria-invalid={Boolean(formError)}
                      aria-describedby={formError ? 'admin-new-user-error' : undefined}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="admin-new-password">密码</FieldLabel>
                    <Input
                      id="admin-new-password"
                      name="new-password"
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setFormError(null)
                      }}
                      placeholder="请输入密码"
                      required
                      autoComplete="new-password"
                    />
                  </Field>
                  {formError ? <FieldError id="admin-new-user-error">{formError}</FieldError> : null}
                  <div className="flex gap-3">
                    <Button type="submit" disabled={createUser.isPending}>
                      {createUser.isPending ? '创建中…' : '创建用户'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false)
                        setUsername('')
                        setPassword('')
                        setFormError(null)
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </FieldGroup>
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
                <div className="flex items-center justify-center py-8" role="status">
                  <Spinner className="size-6 text-primary" aria-label="正在加载用户…" />
              </div>
            )}

            {/* 错误状态 */}
            {isError && (
              <PageState variant="error" title="用户加载失败" description="无法获取用户列表，请稍后重试。" compact />
            )}

            {/* 用户列表 */}
            {data && (
              <>
                {data.length === 0 ? (
                  <PageState
                    variant="empty"
                    title="暂无用户"
                    description="还没有创建任何用户账户。"
                    icon={<UserIcon aria-hidden="true" />}
                    action={<Button onClick={() => setShowForm(true)}>添加第一个用户</Button>}
                    compact
                  />
                ) : (
                  <AdminTableFrame>
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
                              <div className="font-medium">{user.username}</div>
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
                                <Trash2 data-icon="inline-start" aria-hidden="true" />
                                {deleteUser.isPending ? '删除中…' : '删除'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AdminTableFrame>
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
  )
}

export default UserManagement
