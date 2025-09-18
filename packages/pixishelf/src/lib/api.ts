'use client'

export async function apiRequest(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  } as Record<string, string>

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new Error('Unauthorized - redirecting to login')
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
export function createEventSourceWithAuth(url: string): EventSource {
  const separator = url.includes('?') ? '&' : '?'
  const urlWithToken = `${url}${separator}`

  return new EventSource(urlWithToken)
}
