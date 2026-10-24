import 'server-only'
import {
  assertArtworkDedupWritable,
  ArtworkDedupOperationError,
  type ArtworkDedupWriteKind,
  type Prisma
} from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import type { AppTransaction } from '@/lib/prisma'

/** Runs within the caller's Artwork transaction; never acquires a source/root lock. */
export async function assertArtworkDedupAppWrite(tx: AppTransaction, artworkId: number, kind: ArtworkDedupWriteKind) {
  try {
    await assertArtworkDedupWritable(tx as unknown as Prisma.TransactionClient, { artworkId, kind })
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError) {
      if (error.code === 'ARTWORK_CLAIMED')
        {throw new TRPCError({ code: 'CONFLICT', message: '作品正在维护，请稍后重试。' })}
      if (error.code === 'NOT_FOUND') throw new TRPCError({ code: 'NOT_FOUND', message: '作品已不存在。' })
    }
    throw error
  }
}
