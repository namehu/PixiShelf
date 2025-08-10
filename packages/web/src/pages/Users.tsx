import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '../api'

function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      return apiJson<{ items: Array<{ id: number; username: string; createdAt: string }> }>('/api/v1/users')
    }
  })
}

export default function Users() {
  const qc = useQueryClient()
  const users = useUsers()
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  const createUser = useMutation({
    mutationFn: async () => {
      return apiJson('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
    },
    onSuccess: () => {
      setUsername(''); setPassword('')
      qc.invalidateQueries({ queryKey: ['users'] })
    }
  })

  const delUser = useMutation({
    mutationFn: async (id: number) => {
      return apiJson(`/api/v1/users/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] })
  })

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">用户管理</h2>

      <div className="rounded border bg-white p-4">
        <div className="mb-3 text-base font-medium">创建用户</div>
        <div className="flex items-center gap-2 max-w-xl">
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名" className="flex-1 rounded border px-3 py-2 text-sm" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" className="flex-1 rounded border px-3 py-2 text-sm" />
          <button onClick={() => createUser.mutate()} disabled={!username || !password || createUser.isPending} className="rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-50">{createUser.isPending ? '创建中' : '创建'}</button>
        </div>
        {createUser.isError && <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{(createUser.error as any)?.message || '创建失败'}</div>}
      </div>

      <div className="rounded border bg-white p-4">
        <div className="mb-3 text-base font-medium">用户列表</div>
        {users.isLoading ? (
          <div className="text-gray-600">加载中…</div>
        ) : users.isError ? (
          <div className="text-red-600">加载失败</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2">ID</th>
                <th>用户名</th>
                <th>创建时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.data!.items.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="py-2">{u.id}</td>
                  <td>{u.username}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="text-right">
                    <button onClick={() => delUser.mutate(u.id)} className="rounded border border-red-600 px-2 py-1 text-red-700 hover:bg-red-50">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}