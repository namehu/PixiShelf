import 'server-only'
import type { PrismaClient } from '@pixishelf/db'
import { createArtworkDeletionService } from '@pixishelf/job-executors/artwork-delete'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import { requestArchiveArtworkMaintenance } from '@/services/archive/archive-maintenance-service'
import { executeDeletion, readDeletionIntent } from './deletion-content-guard'
export const { deleteArtwork, previewDeleteArtwork } = createArtworkDeletionService({
  database: prisma as unknown as PrismaClient,
  getScanPath,
  requestArchiveArtworkMaintenance,
  logger,
  guard: { executeDeletion, readDeletionIntent }
})
