'use client'

export async function apiRequest(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  } as Record<string, string>

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      setTimeout(() => {
        window.location.href = '/login'
      }, 0)
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
