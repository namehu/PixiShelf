import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'
import { nextCookies } from 'better-auth/next-js'
import type { Prisma } from '@pixishelf/db'

export function createAuth(
  database:
    | Prisma.TransactionClient
    | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'> = prisma,
  useNextCookies = true
) {
  return betterAuth({
    debug: process.env.NODE_ENV !== 'production',
    database: prismaAdapter(database, {
      provider: 'postgresql',
      // A supplied transaction client already owns the complete registration transaction.
      transaction: false
    }),
    plugins: useNextCookies ? [nextCookies()] : [],
    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',') : [],
    user: {
      modelName: 'UserBA'
    },
    account: {
      modelName: 'Account'
    },
    session: {
      modelName: 'Session',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8
    },
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60
    },
    advanced: {
      useSecureCookies:
        process.env.NODE_ENV === 'production' &&
        process.env.BETTER_AUTH_URL?.startsWith('https') &&
        !process.env.BETTER_AUTH_TRUSTED_ORIGINS
    }
  })
}

export const auth = createAuth()

export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
