import React from 'react'

export default function Login() {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || '登录失败')
      localStorage.setItem('token', data.token)
      window.location.href = '/'
    } catch (e: any) {
      setError(e.message || '登录失败')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">登录</h1>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-gray-600">用户名</label>
          <input value={username} onChange={e => setUsername(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm text-gray-600">密码</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
        </div>
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <button type="submit" className="w-full rounded bg-brand-600 px-3 py-2 text-white hover:bg-brand-700">登录</button>
      </form>
    </div>
  )
}