import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '../../../api'
import { UsersResponse } from '@pixishelf/shared'

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
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个用户吗？')) return
    
    try {
      await deleteUser.mutateAsync(id)
    } catch (error) {
      console.error('Failed to delete user:', error)
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">
            用户管理
          </h1>
          <p className="text-neutral-600">
            管理系统用户账户、权限和访问控制
          </p>
        </div>

        {/* 用户管理操作区 */}
        <div className="card p-6">
          {/* 头部操作栏 */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">用户列表</h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="btn btn-primary"
            >
              {showForm ? '取消' : '添加用户'}
            </button>
          </div>

          {/* 添加用户表单 */}
          {showForm && (
            <div className="mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-6">
              <h3 className="text-base font-medium text-neutral-900 mb-4">添加新用户</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input"
                    placeholder="请输入用户名"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    密码
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    placeholder="请输入密码"
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={createUser.isPending || !username.trim() || !password.trim()}
                    className="btn bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {createUser.isPending ? '创建中...' : '创建用户'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false)
                      setUsername('')
                      setPassword('')
                    }}
                    className="btn btn-secondary"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 加载状态 */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3 text-neutral-600">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>加载中...</span>
              </div>
            </div>
          )}

          {/* 错误状态 */}
          {isError && (
            <div className="rounded-xl border border-error-200 bg-error-50 p-4 text-center">
              <div className="text-error-600 font-medium">加载失败</div>
              <div className="text-error-500 text-sm mt-1">无法获取用户列表，请稍后重试</div>
            </div>
          )}

          {/* 用户列表 */}
          {data && (
            <div className="space-y-3">
              {data.items.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-neutral-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-neutral-900 mb-2">暂无用户</h3>
                  <p className="text-neutral-500 mb-4">还没有创建任何用户账户</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="btn btn-primary"
                  >
                    添加第一个用户
                  </button>
                </div>
              ) : (
                data.items.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-xl border border-neutral-200 p-4 hover:bg-neutral-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {/* 用户头像 */}
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-primary-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                      
                      {/* 用户信息 */}
                      <div>
                        <div className="font-medium text-neutral-900">{user.username}</div>
                        <div className="text-sm text-neutral-500">ID: {user.id}</div>
                        <div className="text-sm text-neutral-500">
                          创建时间: {new Date(user.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    
                    {/* 操作按钮 */}
                    <button
                      onClick={() => handleDelete(user.id)}
                      disabled={deleteUser.isPending}
                      className="btn bg-error-600 text-white hover:bg-error-700 disabled:opacity-50 text-sm px-3 py-1"
                      title="删除用户"
                    >
                      {deleteUser.isPending ? '删除中...' : '删除'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 用户统计 */}
          {data && data.items.length > 0 && (
            <div className="mt-6 pt-4 border-t border-neutral-200">
              <div className="text-sm text-neutral-500 text-center">
                共 {data.items.length} 个用户账户
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default UserManagement