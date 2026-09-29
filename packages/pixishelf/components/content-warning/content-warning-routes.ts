import { ROUTES } from '@/lib/constants'

const EXEMPT_ROUTE_PREFIXES = [ROUTES.LOGIN, '/api', '/settings'] as const

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function isContentWarningPath(pathname: string | null): boolean {
  if (!pathname) return false

  return !EXEMPT_ROUTE_PREFIXES.some((route) => matchesRoute(pathname, route))
}
