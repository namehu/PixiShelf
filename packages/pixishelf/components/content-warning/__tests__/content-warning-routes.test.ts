import { describe, expect, it } from 'vitest'
import { isContentWarningPath } from '../content-warning-routes'

describe('isContentWarningPath', () => {
  it.each(['/dashboard', '/artworks', '/artworks/42', '/viewer', '/admin', '/admin/artworks', '/change-password'])(
    'protects %s',
    (pathname) => {
      expect(isContentWarningPath(pathname)).toBe(true)
    }
  )

  it.each(['/settings', '/settings/preferences', '/settings/profile', '/login', '/login/help', '/api/trpc', null])(
    'exempts %s',
    (pathname) => {
      expect(isContentWarningPath(pathname)).toBe(false)
    }
  )
})
