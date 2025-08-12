import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '../api'
import { UsersResponse } from '@pixishelf/shared'

function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<UsersResponse> => {
      return apiJson<UsersResponse>('/api/v1/users')
    }
  })
}

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

export default function Users() {
  const { data, isLoading, isError } = useUsers()
  const deleteUser = useDeleteUser()
  const createUser = useCreateUser()
  const [showForm, setShowForm] = React.useState(false)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

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

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个用户吗？')) return
    
    try {
      await deleteUser.mutateAsync(id)
    } catch (error) {
      console.error('Failed to delete user:', error)
    }
  }

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold">用户管理</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          {showForm ? '取消' : '添加用户'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border bg-gray-50 p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                required
              />
            </div>
            <button
              type="submit"
              disabled={createUser.isPending}
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {createUser.isPending ? '创建中...' : '创建用户'}
            </button>
          </form>
        </div>
      )}

      {isLoading && <div>加载中...</div>}
      {isError && <div className="text-red-600">加载失败</div>}
      {data && (
        <div className="space-y-2">
          {data.items.map((user) => (
            <div key={user.id} className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="font-medium">{user.username}</div>
                <div className="text-sm text-gray-500">ID: {user.id}</div>
                <div className="text-sm text-gray-500">
                  创建时间: {new Date(user.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => handleDelete(user.id)}
                disabled={deleteUser.isPending}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}