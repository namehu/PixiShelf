import { describe, expect, it } from 'vitest'

import { prismaCommandRequiresDatabaseUrl } from '../../scripts/prisma-command.mjs'

describe('Prisma command environment requirements', () => {
  it('allows client generation without a database URL', () => {
    expect(prismaCommandRequiresDatabaseUrl(['generate', '--schema', 'prisma/schema.prisma'])).toBe(false)
  })

  it.each([['validate'], ['db', 'push'], ['migrate', 'deploy'], ['migrate', 'status'], ['studio'], []])(
    'requires a database URL for %j',
    (...arguments_) => {
      expect(prismaCommandRequiresDatabaseUrl(arguments_)).toBe(true)
    }
  )
})
