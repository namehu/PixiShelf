import { Prisma, type PrismaClient } from '@pixishelf/db'
import { createAuth } from '@/lib/auth/better-auth'
import { prisma } from '@/lib/prisma'

export class AlreadyInitializedError extends Error {
  constructor() {
    super('系统已完成初始化，请登录')
  }
}

export async function initializeAdmin(
  username: string,
  password: string,
  // The app only extends Setting result fields; auth delegates retain Prisma's contract.
  database: Pick<PrismaClient, '$transaction'> = prisma as unknown as PrismaClient
) {
  return database.$transaction(
    async (transaction) => {
      // Unlike a process/advisory lock, this also serializes ordinary user INSERTs.
      // ReadCommitted gives the check a fresh snapshot after waiting for the lock.
      await transaction.$executeRaw`LOCK TABLE "UserBA" IN SHARE ROW EXCLUSIVE MODE`
      if (await transaction.userBA.findFirst({ select: { id: true } })) {
        throw new AlreadyInitializedError()
      }

      // Every Better Auth write uses this transaction, including credentials and
      // the automatic session. Cookies are returned to the Action only after commit.
      return createAuth(transaction, false).api.signUpEmail({
        body: { email: `${username}@pixishelf.local`, name: username, password },
        returnHeaders: true
      })
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 }
  )
}
