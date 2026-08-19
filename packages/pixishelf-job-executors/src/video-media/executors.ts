import {
  JOB_DEFINITION_VERSION,
  derivedMediaGcPayloadSchema,
  targetImagePayloadSchema,
  videoMediaProbePayloadSchema
} from '@pixishelf/job-contracts'
import type { ExecutorDefinition } from '@pixishelf/job-runtime'
import { executeDerivedMediaGc } from './gc.ts'
import { executeVideoPoster } from './poster.ts'
import { executeVideoMediaProbe } from './probe.ts'
import type { VideoMediaDatabase, VideoMediaRuntimeConfig } from './types.ts'

export type VideoMediaProbePayload = ReturnType<typeof videoMediaProbePayloadSchema.parse>
export type VideoPosterPayload = ReturnType<typeof targetImagePayloadSchema.parse>
export type DerivedMediaGcPayload = ReturnType<typeof derivedMediaGcPayloadSchema.parse>

export interface VideoMediaExecutorDependencies {
  database: VideoMediaDatabase
  config: VideoMediaRuntimeConfig
  now?: () => Date
}

export function createVideoMediaExecutorRegistrations(
  dependencies: VideoMediaExecutorDependencies
): ExecutorDefinition[] {
  validateConfig(dependencies.config)
  return [
    {
      jobType: 'VIDEO_MEDIA_PROBE',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => videoMediaProbePayloadSchema.parse(payload),
      execute: (context) => executeVideoMediaProbe(context, dependencies)
    } as ExecutorDefinition<VideoMediaProbePayload>,
    {
      jobType: 'VIDEO_POSTER_GENERATION',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => targetImagePayloadSchema.parse(payload),
      execute: (context) => executeVideoPoster(context, dependencies)
    } as ExecutorDefinition<VideoPosterPayload>,
    {
      jobType: 'DERIVED_MEDIA_GC',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => derivedMediaGcPayloadSchema.parse(payload),
      execute: (context) => executeDerivedMediaGc(context, dependencies)
    } as ExecutorDefinition<DerivedMediaGcPayload>
  ] as ExecutorDefinition[]
}

function validateConfig(config: VideoMediaRuntimeConfig) {
  if (!config.scanRoot.trim()) throw new Error('Video media scanRoot is required')
  if (!config.posterStorageRoot.trim()) throw new Error('Video media posterStorageRoot is required')
  if (!config.chapterPreviewStorageRoot.trim()) {
    throw new Error('Video media chapterPreviewStorageRoot is required')
  }
  for (const [name, value, minimum, maximum] of [
    ['probeTimeoutMs', config.probeTimeoutMs, 100, 30 * 60_000],
    ['posterTimeoutMs', config.posterTimeoutMs, 100, 30 * 60_000],
    ['gcBatchSize', config.gcBatchSize, 1, 100],
    ['reconciliationLimit', config.reconciliationLimit, 1, 500]
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > maximum)) {
      throw new Error(`Video media ${name} must be an integer between ${minimum} and ${maximum}`)
    }
  }
}
