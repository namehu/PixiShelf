import { z } from 'zod'
import type { ArtworkSummaryGroup } from '@pixishelf/job-contracts'
import { ReaderInputSchema } from './artwork-reader.dto'

export const SummaryGenerateInputSchema = ReaderInputSchema.extend({ requestId: z.string().uuid(), force: z.boolean().optional() })
export interface ArtworkSummaryDto {
  state: 'MISSING' | 'READY' | 'STALE' | 'BUILDING'
  generationId: string | null
  groups: ArtworkSummaryGroup[]
  job: { id: string; status: string; progress: number; processed: number; total: number } | null
  standalone: number
}
