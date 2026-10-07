import { redactSensitiveText } from './job-redaction'
import { videoKeyframeGenerationPayloadSchema, videoStreamingOptimizationPayloadSchema } from '@pixishelf/job-contracts'
import { z } from 'zod'

const legacyDisplaySchema = z.object({
  schemaVersion: z.literal(1),
  targetImageId: z.number().int().nullable(),
  targetPath: z.string().nullable(),
  mode: z.string().nullable()
})

/** Display-only projection. A legacy snapshot must never become an executable payload. */
export function projectJobTarget<
  T extends { type: string; definitionVersion: number; payload: unknown; legacyDisplay?: unknown }
>(job: T) {
  let target: { targetImageId: number | null; targetPath: string | null; mode: string | null } = {
    targetImageId: null,
    targetPath: null,
    mode: null
  }
  if (job.definitionVersion === 0) {
    const parsed = legacyDisplaySchema.safeParse(job.legacyDisplay)
    if (parsed.success) {
      target = { targetImageId: parsed.data.targetImageId, targetPath: parsed.data.targetPath, mode: parsed.data.mode }
    }
  } else if (job.definitionVersion === 1) {
    const schema =
      job.type === 'VIDEO_KEYFRAME_GENERATION'
        ? videoKeyframeGenerationPayloadSchema
        : job.type === 'VIDEO_STREAMING_OPTIMIZATION'
          ? videoStreamingOptimizationPayloadSchema
          : null
    const parsed = schema?.safeParse(job.payload)
    if (parsed?.success) {
      target = { targetImageId: parsed.data.imageId, targetPath: parsed.data.relativePath, mode: parsed.data.mode }
    }
  }
  const record = { ...job }
  delete record.legacyDisplay
  return {
    ...record,
    ...target,
    targetPath: redactSensitiveText(target.targetPath),
    mode: redactSensitiveText(target.mode)
  }
}
