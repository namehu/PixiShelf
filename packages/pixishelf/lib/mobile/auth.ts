import 'server-only'
import { createAuth } from '@/lib/auth/better-auth'

export const mobileAuth = createAuth(undefined, false, true)
export function mobileAuthHeaders(headers: Headers): Headers {
  const result = new Headers()
  for (const name of ['authorization', 'user-agent', 'x-forwarded-for']) {
    const value = headers.get(name)
    if (value) result.set(name, value)
  }
  return result
}
export async function getMobileSession(headers: Headers) {
  if (!/^Bearer [^\s]{1,4096}$/.test(headers.get('authorization') ?? '')) return null
  return mobileAuth.api.getSession({ headers: mobileAuthHeaders(headers), query: { disableCookieCache: true } })
}
