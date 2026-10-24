import { z } from 'zod'

const text = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'NUL is not allowed')
const canonicalPath = z
  .string()
  .max(4096)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.includes('\\') &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      (value === '' || value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')) &&
      value.split('/').length <= 64,
    'Invalid canonical path'
  )
const root = { logicalRoot: z.enum(['source-media:v1', 'archive-media:v1']), rootIdentity: text }
/** Mirrors the DB source identity fields; the DB remains the only identity hash encoder. */
export const artworkDedupSourceIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PROVIDER'), providerKey: text, externalId: text }).strict(),
  z
    .object({ kind: z.literal('PATH'), ...root, canonicalPath: canonicalPath.refine((value) => value.length > 0) })
    .strict(),
  z.object({ kind: z.literal('DIRECTORY'), ...root, canonicalPath }).strict()
])
export type ArtworkDedupSourceIdentity = z.infer<typeof artworkDedupSourceIdentitySchema>
const generation = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(
    (value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'Generation exceeds database bigint'
  )
const proof = z
  .object({
    identity: artworkDedupSourceIdentitySchema,
    sourceId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !value.includes('\0')),
    generation
  })
  .strict()
function identityTuple(identity: ArtworkDedupSourceIdentity) {
  return identity.kind === 'PROVIDER'
    ? [1, identity.kind, null, null, null, identity.providerKey, identity.externalId]
    : [1, identity.kind, identity.logicalRoot, identity.rootIdentity, identity.canonicalPath, null, null]
}
/** Server storage only. This schema is deliberately absent from client command/job payload schemas. */
export const artworkDedupSourceSnapshotSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(proof).min(1).max(2)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.sources.map((item) => JSON.stringify(identityTuple(item.identity)))).size !== value.sources.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate source identity', path: ['sources'] })
    if (new Set(value.sources.map((item) => item.sourceId)).size !== value.sources.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate source ID', path: ['sources'] })
  })
export type ArtworkDedupSourceSnapshot = z.infer<typeof artworkDedupSourceSnapshotSchema>

/** Null/missing/invalid means no proof; never coerce it into a newly captured generation. */
export function parseArtworkDedupSourceSnapshot(value: unknown): ArtworkDedupSourceSnapshot {
  return artworkDedupSourceSnapshotSchema.parse(value)
}
export function serializeArtworkDedupSourceSnapshot(
  sources: readonly {
    identity: ArtworkDedupSourceIdentity
    sourceId: string
    generation: bigint
  }[]
): ArtworkDedupSourceSnapshot {
  return parseArtworkDedupSourceSnapshot({
    version: 1,
    sources: sources.map((source) => {
      if (typeof source.generation !== 'bigint') throw new TypeError('Generation must be bigint')
      return { ...source, generation: source.generation.toString() }
    })
  })
}
