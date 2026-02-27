import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'
import { nextCookies } from 'better-auth/next-js'

export const auth = betterAuth({
  debug: true,
  database: prismaAdapter(prisma, {
    provider: 'postgresql'
  }),
  plugins: [nextCookies()],
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
    minPasswordLength: 6
  },
  cookieCache: {
    enabled: true,
    maxAge: 5 * 60
  }
})

export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
