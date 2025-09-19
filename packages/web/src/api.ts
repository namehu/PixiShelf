// Centralized API utilities with token handling
export function getAuthHeader() {
  // 在服务端渲染时返回空对象，避免水合不匹配
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const token = localStorage.getItem('token')
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  } catch {
    // 忽略 localStorage 访问错误
  }

  return {}
}

export async function apiRequest(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...(options.headers || {})
  } as Record<string, string>

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 401) {
    // Clear invalid token and redirect to login
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('token')
        // 使用 setTimeout 避免在 SSR 期间执行
        setTimeout(() => {
          window.location.href = '/login'
        }, 0)
      } catch {
        // 忽略 localStorage 访问错误
      }
    }
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `HTTP ${response.status}`)
  }

  return response
}

export async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await apiRequest(url, options)
  return response.json() as Promise<T>
}

// SSE with token support for EventSource
export function createEventSourceWithAuth(url: string): EventSource | null {
  // 只在客户端环境创建 EventSource
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const token = localStorage.getItem('token')
    if (token) {
      const urlWithAuth = new URL(url)
      urlWithAuth.searchParams.set('token', token)
      return new EventSource(urlWithAuth.toString())
    }
  } catch {
    // 忽略 localStorage 访问错误
  }

  return null
}
