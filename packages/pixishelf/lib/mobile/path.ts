export const MOBILE_API_PREFIX = '/api/mobile/v1'

export function isMobileApiPath(pathname: string): boolean {
  return pathname === MOBILE_API_PREFIX || pathname.startsWith(`${MOBILE_API_PREFIX}/`)
}

export function isMobileLoginRequest(pathname: string, method: string): boolean {
  return pathname === `${MOBILE_API_PREFIX}/session` && method === 'POST'
}
