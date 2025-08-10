// Centralized API utilities with token handling
export function getAuthHeader() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiRequest(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...(options.headers || {}),
  } as Record<string, string>

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    // Clear invalid token and redirect to login
    try { localStorage.removeItem('token') } catch {}
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
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  if (!token) {
    throw new Error('No auth token available for SSE')
  }
  
  // EventSource doesn't support custom headers, pass token via query parameter for SSE endpoints only
  const separator = url.includes('?') ? '&' : '?'
  const urlWithToken = `${url}${separator}token=${encodeURIComponent(token)}`
  
  return new EventSource(urlWithToken)
}