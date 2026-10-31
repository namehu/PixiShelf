import { prisma } from '@/lib/prisma'
import type { PrismaClient } from '@pixishelf/db'
import { createDeletionGuard } from '@pixishelf/job-executors/artwork-delete'
import { resolveContentPath, publishContentOwner } from './content-source-guard'
export {
  deletionMembers,
  type DeletionManifest,
  type DeletionPlan,
  type DeletionKind
} from '@pixishelf/job-executors/artwork-delete'
export const { executeDeletion, readDeletionIntent } = createDeletionGuard(prisma as unknown as PrismaClient, {
  resolveContentPath,
  publishContentOwner: publishContentOwner as unknown as Parameters<
    typeof createDeletionGuard
  >[1]['publishContentOwner']
})
