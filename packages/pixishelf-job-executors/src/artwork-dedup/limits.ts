export const ARTWORK_DEDUP_LIMITS = Object.freeze({
  mediaPage: 500,
  statConcurrency: 4,
  hashConcurrency: 1,
  cacheBatch: 100,
  sliceMs: 10_000,
  sliceBytes: 256n * 1024n * 1024n,
  cooldownMs: 3_000,
  progressMs: 10_000,
  stallMs: 30_000,
  closeMs: 5_000,
  progressIpcMs: 250,
  maxPathBytes: 8192
})
