import { Prisma, type ArtworkDedupSourceIdentity } from '@prisma/client'
import { lockCreatorCatalog } from './creators'
import {
  assertContentPath,
  assertContentInteger,
  assertContentText,
  directoryAncestors,
  lockContentArtworks,
  lockContentDirectories
} from './media-content-common'
import type { MediaContentDirectoryKey, MediaContentLogicalRoot, MediaContentWriteScope } from './media-content-types'
import { MediaContentConflictError } from './media-content-types'
import {
  ArtworkDedupOperationError,
  assertArtworkDedupOperationExecution,
  type ArtworkDedupOperationExecution
} from './artwork-dedup-operation'
import { artworkDedupBoundRoots } from './artwork-dedup-ownership'
import { validateArtworkDedupOperationSnapshot } from './artwork-dedup-review'

export type ArtworkDedupSourceIdentityInput =
  | { kind: 'PROVIDER'; providerKey: string; externalId: string }
  | { kind: 'PATH' | 'DIRECTORY'; logicalRoot: MediaContentLogicalRoot; rootIdentity: string; canonicalPath: string }
export type ArtworkDedupCapturedSource = {
  identity: ArtworkDedupSourceIdentityInput
  sourceId: string
  generation: bigint
}
export type ArtworkDedupWriteKind = 'READING' | 'ORGANIZATION' | 'STRUCTURE' | 'CONTENT' | 'DELETE'

function identityKey(
  kind: Prisma.Sql,
  logicalRoot: Prisma.Sql,
  root: Prisma.Sql,
  path: Prisma.Sql,
  provider: Prisma.Sql,
  externalId: Prisma.Sql
) {
  return Prisma.sql`encode(sha256(convert_to(jsonb_build_array(1,${kind},${logicalRoot},${root},${path},${provider},${externalId})::text,'UTF8')),'hex')`
}
function normalizedIdentity(identity: ArtworkDedupSourceIdentityInput) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity))
    throw new TypeError('Invalid source identity')
  const fields =
    identity.kind === 'PROVIDER'
      ? ['kind', 'providerKey', 'externalId']
      : ['kind', 'logicalRoot', 'rootIdentity', 'canonicalPath']
  if (Object.keys(identity).some((key) => !fields.includes(key))) throw new TypeError('Invalid source identity fields')
  if (identity.kind === 'PROVIDER') {
    assertContentText(identity.providerKey, 'provider key')
    assertContentText(identity.externalId, 'external ID')
    return { ...identity, logicalRoot: null, rootIdentity: null, canonicalPath: null }
  }
  if (!['PATH', 'DIRECTORY'].includes(identity.kind)) throw new TypeError('Invalid source identity kind')
  if (!['source-media:v1', 'archive-media:v1'].includes(identity.logicalRoot))
    throw new TypeError('Invalid logical root')
  assertContentText(identity.rootIdentity, 'root identity')
  assertContentPath(identity.canonicalPath, identity.kind === 'DIRECTORY')
  return { ...identity, providerKey: null, externalId: null }
}
const contains = (directory: Prisma.Sql, path: Prisma.Sql) =>
  Prisma.sql`(${directory}='' OR ${directory}=${path} OR left(${path},length(${directory})+1)=${directory}||'/')`

/** Root coordination already serializes declarations; no source/operation lock is taken here. */
export async function assertArtworkDedupPathWritable(
  tx: Prisma.TransactionClient,
  input: { directory: MediaContentDirectoryKey; scope: MediaContentWriteScope }
) {
  const path = input.scope.kind === 'PATH' ? input.scope.relativePath : input.directory.relativeDirectory
  assertContentPath(path, input.scope.kind === 'DIRECTORY')
  await lockContentDirectories(tx, [input.directory])
  const ancestors = directoryAncestors(path)
  const [row] = await tx.$queryRaw<{ held: boolean }[]>(Prisma.sql`SELECT EXISTS(
    SELECT 1 FROM "ArtworkDedupSourceIdentity" s WHERE s."logicalRoot"=${input.directory.logicalRoot} AND s."rootIdentity"=${input.directory.rootIdentity}
    AND s.status IN('HOLD','TOMBSTONE') AND (s."canonicalPath"=${path} OR s.kind='DIRECTORY' AND s."canonicalPath" IN(${Prisma.join(ancestors)})
      ${input.scope.kind === 'DIRECTORY' ? Prisma.sql`OR ${contains(Prisma.sql`${path}`, Prisma.sql`s."canonicalPath"`)}` : Prisma.empty})
  ) held`)
  if (row!.held) throw new ArtworkDedupOperationError('SOURCE_HELD')
}
type NormalizedSourceIdentity = ReturnType<typeof normalizedIdentity>
type SourceSlot = { identity: ArtworkDedupSourceIdentityInput; value: NormalizedSourceIdentity; group: number }
type KeyedSource = NormalizedSourceIdentity & { identityKey: string }
const sourceFields = ['kind', 'logicalRoot', 'rootIdentity', 'canonicalPath', 'providerKey', 'externalId'] as const

function sourceRecords(json: string) {
  return Prisma.sql`jsonb_to_recordset(${json}::jsonb) AS p("identityKey" text,kind text,"logicalRoot" text,"rootIdentity" text,"canonicalPath" text,"providerKey" text,"externalId" text)`
}
function sourceSlots(groups: readonly (readonly ArtworkDedupSourceIdentityInput[])[]) {
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 10000)
    throw new RangeError('Source groups must contain 1 to 10000 inputs')
  const slots: SourceSlot[] = []
  for (const [group, identities] of groups.entries()) {
    if (!Array.isArray(identities) || identities.length < 1 || identities.length > 2)
      throw new RangeError('Each source input must contain 1 to 2 identities')
    for (const identity of identities) {
      const value = normalizedIdentity(identity)
      const snapshot: ArtworkDedupSourceIdentityInput =
        value.kind === 'PROVIDER'
          ? { kind: value.kind, providerKey: value.providerKey, externalId: value.externalId }
          : {
              kind: value.kind,
              logicalRoot: value.logicalRoot,
              rootIdentity: value.rootIdentity,
              canonicalPath: value.canonicalPath
            }
      slots.push({ identity: snapshot, value, group })
    }
  }
  return slots
}

/** One complete bounded page per transaction: all roots, then the database's global source-key order. */
async function lockSourceGroups(tx: Prisma.TransactionClient, slots: readonly SourceSlot[], capture: boolean) {
  const keys = await tx.$queryRaw<{ ordinal: number; key: string }[]>(Prisma.sql`WITH keys AS (
    SELECT p.ordinal,${identityKey(Prisma.sql`p.kind`, Prisma.sql`p."logicalRoot"`, Prisma.sql`p."rootIdentity"`, Prisma.sql`p."canonicalPath"`, Prisma.sql`p."providerKey"`, Prisma.sql`p."externalId"`)} key
    FROM jsonb_to_recordset(${JSON.stringify(slots.map((slot, ordinal) => ({ ...slot.value, ordinal })))}::jsonb)
      AS p(ordinal integer,kind text,"logicalRoot" text,"rootIdentity" text,"canonicalPath" text,"providerKey" text,"externalId" text))
    SELECT * FROM keys ORDER BY key COLLATE "C",ordinal`)
  const groupKeys = new Map<number, Set<string>>(),
    unique = new Map<string, KeyedSource>()
  for (const { ordinal, key } of keys) {
    const slot = slots[ordinal]!
    const seen = groupKeys.get(slot.group) ?? new Set<string>()
    if (seen.has(key)) throw new RangeError('Duplicate source identity in an input')
    seen.add(key)
    groupKeys.set(slot.group, seen)
    unique.set(key, { ...slot.value, identityKey: key })
  }
  const roots = new Map<MediaContentLogicalRoot, MediaContentDirectoryKey>()
  for (const source of unique.values()) {
    if (source.kind === 'PROVIDER') continue
    if (roots.has(source.logicalRoot) && roots.get(source.logicalRoot)!.rootIdentity !== source.rootIdentity)
      throw new MediaContentConflictError('ROOT_CHANGED')
    roots.set(source.logicalRoot, {
      logicalRoot: source.logicalRoot,
      rootIdentity: source.rootIdentity,
      relativeDirectory: ''
    })
  }
  await lockContentDirectories(tx, [...roots.values()])
  const records = sourceRecords(JSON.stringify([...unique.values()]))
  if (roots.size) {
    // Materialize ancestors first: otherwise the planner can join by root before expanding path segments.
    const [overlap] = await tx.$queryRaw<{ held: boolean }[]>(Prisma.sql`
      WITH source_paths AS MATERIALIZED(SELECT p.* FROM ${records} WHERE p.kind IN('PATH','DIRECTORY')),
      held_paths AS MATERIALIZED(
        SELECT s.kind,s."logicalRoot",s."rootIdentity",s."canonicalPath" FROM "ArtworkDedupSourceIdentity" s
        WHERE s.kind IN('PATH','DIRECTORY') AND s.status IN('HOLD','TOMBSTONE')
          AND EXISTS(SELECT 1 FROM source_paths p WHERE p."logicalRoot"=s."logicalRoot" AND p."rootIdentity"=s."rootIdentity")),
      source_ancestors AS MATERIALIZED(
        SELECT p."logicalRoot",p."rootIdentity",coalesce(array_to_string((string_to_array(p."canonicalPath",'/'))[1:n],'/'),'') "canonicalPath"
        FROM source_paths p CROSS JOIN LATERAL generate_series(0,cardinality(string_to_array(p."canonicalPath",'/'))) n),
      held_ancestors AS MATERIALIZED(
        SELECT s."logicalRoot",s."rootIdentity",coalesce(array_to_string((string_to_array(s."canonicalPath",'/'))[1:n],'/'),'') "canonicalPath"
        FROM held_paths s CROSS JOIN LATERAL generate_series(0,cardinality(string_to_array(s."canonicalPath",'/'))) n)
      SELECT EXISTS(SELECT 1 FROM source_paths p JOIN held_paths s ON
        s."logicalRoot"=p."logicalRoot" AND s."rootIdentity"=p."rootIdentity" AND s."canonicalPath"=p."canonicalPath")
      OR EXISTS(SELECT 1 FROM source_ancestors p JOIN held_paths s ON
        s.kind='DIRECTORY' AND s."logicalRoot"=p."logicalRoot" AND s."rootIdentity"=p."rootIdentity" AND s."canonicalPath"=p."canonicalPath")
      OR CASE WHEN EXISTS(SELECT 1 FROM source_paths WHERE kind='DIRECTORY') THEN
        EXISTS(SELECT 1 FROM held_ancestors s JOIN source_paths p ON
          p.kind='DIRECTORY' AND p."logicalRoot"=s."logicalRoot" AND p."rootIdentity"=s."rootIdentity" AND p."canonicalPath"=s."canonicalPath")
        ELSE FALSE END held`)
    if (overlap!.held) throw new ArtworkDedupOperationError('SOURCE_HELD')
  }
  if (capture)
    await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ArtworkDedupSourceIdentity"(id,"identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId","displayName","updatedAt")
    SELECT gen_random_uuid()::text,p."identityKey",p.kind,p."logicalRoot",p."rootIdentity",p."canonicalPath",p."providerKey",p."externalId",'媒体来源',CURRENT_TIMESTAMP
    FROM ${records} ORDER BY p."identityKey" COLLATE "C" ON CONFLICT("identityKey") DO NOTHING`)
  const rows = await tx.$queryRaw<ArtworkDedupSourceIdentity[]>(Prisma.sql`
    SELECT s.* FROM "ArtworkDedupSourceIdentity" s JOIN ${records} ON s."identityKey"=p."identityKey"
    ORDER BY s."identityKey" COLLATE "C" FOR UPDATE OF s`)
  const byKey = new Map(rows.map((row) => [row.identityKey, row]))
  for (const expected of unique.values()) {
    const row = byKey.get(expected.identityKey)
    if (!row || sourceFields.some((field) => row[field] !== expected[field]))
      throw new ArtworkDedupOperationError('SOURCE_IDENTITY_CHANGED')
    if (row.status !== 'OPEN' || row.ownerOperationId !== null) throw new ArtworkDedupOperationError('SOURCE_HELD')
  }
  const ordered: ArtworkDedupSourceIdentity[] = []
  for (const { ordinal, key } of keys) ordered[ordinal] = byKey.get(key)!
  return ordered
}

export async function captureArtworkDedupSourceGroups(
  tx: Prisma.TransactionClient,
  input: { groups: readonly (readonly ArtworkDedupSourceIdentityInput[])[] }
): Promise<ArtworkDedupCapturedSource[][]> {
  const slots = sourceSlots(input.groups)
  const rows = await lockSourceGroups(tx, slots, true)
  const result: ArtworkDedupCapturedSource[][] = input.groups.map(() => [])
  for (const [ordinal, slot] of slots.entries()) {
    const row = rows[ordinal]!
    result[slot.group]!.push({ identity: slot.identity, sourceId: row.id, generation: row.generation })
  }
  return result
}

export async function assertArtworkDedupSourceGroups(
  tx: Prisma.TransactionClient,
  input: { groups: readonly (readonly ArtworkDedupCapturedSource[])[] }
): Promise<void> {
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 10000)
    throw new RangeError('Source groups must contain 1 to 10000 inputs')
  const proofs: ArtworkDedupCapturedSource[] = []
  const identities = input.groups.map((group) => {
    if (!Array.isArray(group) || group.length < 1 || group.length > 2)
      throw new RangeError('Each source input must contain 1 to 2 identities')
    const ids = new Set<string>()
    return group.map((proof) => {
      if (
        !proof ||
        typeof proof !== 'object' ||
        Object.keys(proof).some((key) => !['identity', 'sourceId', 'generation'].includes(key))
      )
        throw new TypeError('Invalid source proof')
      assertContentText(proof.sourceId, 'source ID')
      if (proof.sourceId.length > 128 || ids.has(proof.sourceId)) throw new TypeError('Invalid or duplicate source ID')
      assertContentInteger(proof.generation, 'source generation')
      ids.add(proof.sourceId)
      proofs.push({ identity: proof.identity, sourceId: proof.sourceId, generation: proof.generation })
      return proof.identity
    })
  })
  const rows = await lockSourceGroups(tx, sourceSlots(identities), false)
  for (const [ordinal, proof] of proofs.entries()) {
    const row = rows[ordinal]!
    if (row.id !== proof.sourceId) throw new ArtworkDedupOperationError('SOURCE_IDENTITY_CHANGED')
    if (row.generation !== proof.generation) throw new ArtworkDedupOperationError('SOURCE_GENERATION_CHANGED')
  }
}

export async function captureArtworkDedupSources(
  tx: Prisma.TransactionClient,
  input: { identities: readonly ArtworkDedupSourceIdentityInput[] }
): Promise<ArtworkDedupCapturedSource[]> {
  return (await captureArtworkDedupSourceGroups(tx, { groups: [input.identities] }))[0]!
}
export async function assertArtworkDedupSources(
  tx: Prisma.TransactionClient,
  input: { sources: readonly ArtworkDedupCapturedSource[] }
): Promise<void> {
  await assertArtworkDedupSourceGroups(tx, { groups: [input.sources] })
}

/** Compatibility primitive; persisted proofs must use assertArtworkDedupSources with their original source ID. */
export async function captureArtworkDedupSourceGeneration(
  tx: Prisma.TransactionClient,
  input: { identity: ArtworkDedupSourceIdentityInput }
) {
  const source = (await captureArtworkDedupSources(tx, { identities: [input.identity] }))[0]!
  return { sourceId: source.sourceId, generation: source.generation }
}
export async function assertArtworkDedupSourcePublication(
  tx: Prisma.TransactionClient,
  input: { identity: ArtworkDedupSourceIdentityInput; expectedGeneration: bigint }
) {
  const source = await captureArtworkDedupSourceGeneration(tx, { identity: input.identity })
  if (source.generation !== input.expectedGeneration) throw new ArtworkDedupOperationError('SOURCE_GENERATION_CHANGED')
  return source
}
export async function assertArtworkDedupWritable(
  tx: Prisma.TransactionClient,
  input: { artworkId: number; kind: ArtworkDedupWriteKind }
) {
  if (
    !Number.isSafeInteger(input.artworkId) ||
    input.artworkId < 1 ||
    !['READING', 'ORGANIZATION', 'STRUCTURE', 'CONTENT', 'DELETE'].includes(input.kind)
  )
    throw new TypeError('Invalid artwork write')
  if (!(await lockContentArtworks(tx, [input.artworkId])).length) throw new ArtworkDedupOperationError('NOT_FOUND')
  const claim = await tx.artworkDedupClaim.findUnique({ where: { artworkId: input.artworkId } })
  if (claim && !(claim.role === 'KEEPER' && input.kind === 'READING'))
    throw new ArtworkDedupOperationError('ARTWORK_CLAIMED')
}
export function artworkDedupUrlHoldPredicate(artworkId: Prisma.Sql) {
  return Prisma.sql`EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" a JOIN "ArtworkDedupOperation" o ON o.id=a."operationId"
    WHERE a."artworkId"=${artworkId} AND a."isUrl" AND a.role='COPY' AND (
      EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c WHERE c."artworkId"=a."artworkId" AND c."operationId"=o.id AND c.role='COPY')
      OR a.status IN('ISOLATING','ISOLATED','RESTORING','PURGING','RECOVERY_REQUIRED')
      OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationSource" b JOIN "ArtworkDedupSourceIdentity" s ON s.id=b."sourceId" WHERE b."operationId"=o.id AND b."artworkId"=a."artworkId" AND s.status IN('HOLD','TOMBSTONE'))
      OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=o.id AND f."artworkId"=a."artworkId" AND(f.status IN('MOVE_INTENT','MOVED','RESTORE_INTENT','DELETE_INTENT') OR EXISTS(SELECT 1 FROM "ArtworkDedupFileReceipt" r WHERE r."fileId"=f."fileId" AND r.status='INTENT')))))`
}
export async function assertNoArtworkDedupUrlHold(tx: Prisma.TransactionClient, input: { artworkId: number }) {
  if (!(await lockContentArtworks(tx, [input.artworkId])).length) throw new ArtworkDedupOperationError('NOT_FOUND')
  const [row] = await tx.$queryRaw<{ held: boolean }[]>(
    Prisma.sql`SELECT ${artworkDedupUrlHoldPredicate(Prisma.sql`${input.artworkId}::integer`)} held`
  )
  if (row!.held) throw new ArtworkDedupOperationError('URL_HELD')
}

function scopeSources(operationId: string, roots: ReturnType<typeof artworkDedupBoundRoots>) {
  return Prisma.sql`WITH raw_sources AS(
    SELECT f."artworkId",'PATH'::text kind,f."logicalRoot",f."rootIdentity",f."canonicalPath",NULL::text "providerKey",NULL::text "externalId" FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=${operationId}
    UNION SELECT o."artworkId",'DIRECTORY',${roots.source.logicalRoot},${roots.source.rootIdentity},rtrim(ltrim(replace(o."storagePath",chr(92),'/'),'/'),'/'),NULL,NULL FROM "ArtworkDedupOperationArtwork" o JOIN "Artwork" a ON a.id=o."artworkId" WHERE o."operationId"=${operationId} AND a."createdVia"='LOCAL_DIRECTORY' AND nullif(o."storagePath",'') IS NOT NULL
    UNION SELECT o."artworkId",'PROVIDER',NULL,NULL,NULL,r."providerKey",r."externalId" FROM "ArtworkDedupOperationArtwork" o JOIN artwork_external_refs r ON r."artworkId"=o."artworkId" WHERE o."operationId"=${operationId}
    UNION SELECT o."artworkId",'PROVIDER',NULL,NULL,NULL,'pixiv',o."externalId" FROM "ArtworkDedupOperationArtwork" o JOIN "Artwork" a ON a.id=o."artworkId" WHERE o."operationId"=${operationId} AND a."createdVia"='PIXIV_SCAN' AND nullif(o."externalId",'') IS NOT NULL
  ), sources AS(SELECT r.*,${identityKey(Prisma.sql`r.kind`, Prisma.sql`r."logicalRoot"`, Prisma.sql`r."rootIdentity"`, Prisma.sql`r."canonicalPath"`, Prisma.sql`r."providerKey"`, Prisma.sql`r."externalId"`)} "identityKey" FROM raw_sources r)`
}

/** Caller owns runtime fence. Every conflict must abort the surrounding transaction. No file action or release. */
export async function claimArtworkDedupScope(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; expectedVersion: number }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  if (op.version !== input.expectedVersion) throw new ArtworkDedupOperationError('STALE')
  if (
    !((op.mode === 'ISOLATE' && op.status === 'ISOLATING') ||
      (op.mode === 'DIRECT_DELETE' && op.status === 'DRAINING' && [1, 2, 3, 4].includes(op.protocolVersion ?? 0) && op.scopeDigest && op.directDeleteConfirmedAt)) ||
    !op.validatedAt ||
    (op.mode === 'ISOLATE' && (!op.backupCheckpointRef || !op.backupConfirmedAt)) ||
    !op.externalWritesStoppedAt ||
    (op.requiresOrganizationConfirmation && !op.organizationConfirmedAt)
  )
    throw new ArtworkDedupOperationError('INVALID_STATE')
  await tx.$queryRaw(
    Prisma.sql`SELECT "runId" FROM "ArtworkDedupReviewState" WHERE "runId"=${op.runId} AND "userId"=${op.requestedBy} FOR SHARE`
  )
  const review = await tx.artworkDedupReviewState.findUnique({
    where: { runId_userId: { runId: op.runId, userId: op.requestedBy } }
  })
  if (review?.reviewRevision !== op.frozenReviewRevision) throw new ArtworkDedupOperationError('STALE')
  await lockCreatorCatalog(tx)
  const roots = artworkDedupBoundRoots(op.rootBindings)
  await lockContentDirectories(
    tx,
    [roots.source, roots.archive].map((root) => ({
      ...root,
      logicalRoot: root.logicalRoot as MediaContentLogicalRoot,
      relativeDirectory: ''
    }))
  )
  const sourceSql = scopeSources(op.id, roots)
  const [bad] = await tx.$queryRaw<{ bad: boolean }[]>(Prisma.sql`${sourceSql} SELECT
    NOT EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id}) OR
    EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id} AND(role NOT IN('KEEPER','COPY') OR NOT "inventoryComplete" OR (${op.preparationVersion}=1 AND NOT "inspectionComplete") OR "errorCode" IS NOT NULL)) OR
    EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=${op.id} AND((${op.preparationVersion}=1 AND (f.status<>'VERIFIED' OR f."inspectionStatus"<>'VERIFIED') OR ${op.preparationVersion}=2 AND (f."verificationSpec" IS NULL OR f.status NOT IN('PENDING','VERIFIED'))) OR f."ownershipStatus"<>'VERIFIED' OR f."requiresReview" OR f."blockReason" IS NOT NULL OR NOT((f."logicalRoot"=${roots.source.logicalRoot} AND f."rootIdentity"=${roots.source.rootIdentity}) OR(f."logicalRoot"=${roots.archive.logicalRoot} AND f."rootIdentity"=${roots.archive.rootIdentity})))) OR
    (SELECT count(*) FROM "ArtworkDedupOperationFile" WHERE "operationId"=${op.id})<>${op.preparedFiles} OR
    EXISTS(SELECT 1 FROM sources s WHERE (s.kind='PROVIDER' AND(nullif(s."providerKey",'') IS NULL OR nullif(s."externalId",'') IS NULL)) OR(s.kind<>'PROVIDER' AND(s."canonicalPath"='' OR length(s."canonicalPath")>4096 OR left(s."canonicalPath",1)='/' OR position(chr(92) in s."canonicalPath")>0 OR s."canonicalPath" LIKE '%//%' OR s."canonicalPath"~'(^|/)\\.{1,2}(/|$)' OR s."canonicalPath"~'^[A-Za-z]:' OR cardinality(string_to_array(s."canonicalPath",'/'))>64))) bad`)
  if (bad!.bad) throw new ArtworkDedupOperationError('INCOMPLETE_INVENTORY')
  await tx.$executeRaw(
    Prisma.sql`${sourceSql} INSERT INTO "ArtworkDedupSourceIdentity"(id,"identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId","displayName","updatedAt") SELECT gen_random_uuid()::text,"identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId",'媒体来源',CURRENT_TIMESTAMP FROM(SELECT DISTINCT "identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId" FROM sources) s ORDER BY "identityKey" COLLATE "C" ON CONFLICT("identityKey") DO NOTHING`
  )
  await tx.$queryRaw(
    Prisma.sql`${sourceSql} SELECT count(*) FROM(SELECT i.id FROM "ArtworkDedupSourceIdentity" i WHERE i."identityKey" IN(SELECT "identityKey" FROM sources) ORDER BY i."identityKey" COLLATE "C" FOR UPDATE OF i) locked`
  )
  const [held] = await tx.$queryRaw<{ held: boolean }[]>(
    Prisma.sql`${sourceSql} SELECT EXISTS(SELECT 1 FROM "ArtworkDedupSourceIdentity" i JOIN sources s ON s."identityKey"=i."identityKey" WHERE NOT(i.status='OPEN' AND i."ownerOperationId" IS NULL OR i.status='HOLD' AND i."ownerOperationId"=${op.id})) held`
  )
  if (held!.held) throw new ArtworkDedupOperationError('SOURCE_HELD')
  await tx.$executeRaw(
    Prisma.sql`${sourceSql} INSERT INTO "ArtworkDedupOperationSource"("operationId","artworkId","sourceId","frozenGeneration") SELECT DISTINCT ${op.id},s."artworkId",i.id,i.generation FROM sources s JOIN "ArtworkDedupSourceIdentity" i ON i."identityKey"=s."identityKey" ON CONFLICT DO NOTHING`
  )
  // Compare directory ancestors, not all pairs of file paths. Depth is bounded by the canonical path contract.
  const ours = Prisma.sql`SELECT DISTINCT s.* FROM "ArtworkDedupOperationSource" b JOIN "ArtworkDedupSourceIdentity" s ON s.id=b."sourceId" WHERE b."operationId"=${op.id}`
  const ancestor = Prisma.sql`coalesce(array_to_string((string_to_array(p."canonicalPath",'/'))[1:n],'/'),'')`
  const [overlap] = await tx.$queryRaw<
    { held: boolean }[]
  >(Prisma.sql`WITH ours AS MATERIALIZED(${ours}), held AS MATERIALIZED(SELECT * FROM "ArtworkDedupSourceIdentity" WHERE kind IN('PATH','DIRECTORY') AND status IN('HOLD','TOMBSTONE') AND "ownerOperationId" IS DISTINCT FROM ${op.id})
    SELECT EXISTS(SELECT 1 FROM ours p CROSS JOIN LATERAL generate_series(0,cardinality(string_to_array(p."canonicalPath",'/'))) n JOIN held h ON h.kind='DIRECTORY' AND h."logicalRoot"=p."logicalRoot" AND h."rootIdentity"=p."rootIdentity" AND h."canonicalPath"=${ancestor})
      OR EXISTS(SELECT 1 FROM held p CROSS JOIN LATERAL generate_series(0,cardinality(string_to_array(p."canonicalPath",'/'))) n JOIN ours d ON d.kind='DIRECTORY' AND d."logicalRoot"=p."logicalRoot" AND d."rootIdentity"=p."rootIdentity" AND d."canonicalPath"=${ancestor}) held`)
  if (overlap!.held) throw new ArtworkDedupOperationError('SOURCE_HELD')
  const [writing] = await tx.$queryRaw<{ writing: boolean }[]>(
    Prisma.sql`WITH ours AS(${ours}) SELECT EXISTS(SELECT 1 FROM "MediaContentPathWrite" w JOIN "MediaContentDirectoryState" d ON d.id=w."directoryId" JOIN ours s ON s."logicalRoot"=d."logicalRoot" WHERE w.status IN('ACTIVE','READY','RECOVERY_REQUIRED') AND(s.kind='PATH' AND(w.scope='PATH' AND w."relativePath"=s."canonicalPath" OR w.scope='DIRECTORY' AND ${contains(Prisma.sql`d."relativeDirectory"`, Prisma.sql`s."canonicalPath"`)}) OR s.kind='DIRECTORY' AND(w.scope='PATH' AND ${contains(Prisma.sql`s."canonicalPath"`, Prisma.sql`w."relativePath"`)} OR w.scope='DIRECTORY' AND(${contains(Prisma.sql`d."relativeDirectory"`, Prisma.sql`s."canonicalPath"`)} OR ${contains(Prisma.sql`s."canonicalPath"`, Prisma.sql`d."relativeDirectory"`)})))) writing`
  )
  if (writing!.writing) throw new ArtworkDedupOperationError('CONTENT_WRITING')
  if (!(await validateArtworkDedupOperationSnapshot(tx, op.id))) throw new ArtworkDedupOperationError('STALE')
  const [conflict] = await tx.$queryRaw<{ conflict: boolean }[]>(Prisma.sql`SELECT
    EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c JOIN "ArtworkDedupOperationArtwork" a ON a."artworkId"=c."artworkId" WHERE a."operationId"=${op.id} AND(c."operationId"<>${op.id} OR c."executionVersion"<>${op.executionVersion} OR c.role<>a.role)) OR
    EXISTS(SELECT 1 FROM "MediaContentSource" s JOIN "Image" i ON i.id=s."imageId" JOIN "ArtworkDedupOperationArtwork" a ON a."artworkId"=i."artworkId" WHERE a."operationId"=${op.id} AND s."writeToken" IS NOT NULL) OR
    EXISTS(SELECT 1 FROM "ArtworkDedupOperationSource" b JOIN "ArtworkDedupSourceIdentity" s ON s.id=b."sourceId" WHERE b."operationId"=${op.id} AND b."frozenGeneration"<>s.generation) conflict`)
  if (conflict!.conflict) throw new ArtworkDedupOperationError('CLAIM_CONFLICT')
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "ArtworkDedupClaim"("artworkId","operationId",role,"executionVersion") SELECT "artworkId",${op.id},role,${op.executionVersion} FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id} ORDER BY "artworkId" ON CONFLICT DO NOTHING`
  )
  await tx.$executeRaw(
    Prisma.sql`UPDATE "ArtworkDedupSourceIdentity" SET status='HOLD',"ownerOperationId"=${op.id},"updatedAt"=CURRENT_TIMESTAMP WHERE id IN(SELECT "sourceId" FROM "ArtworkDedupOperationSource" WHERE "operationId"=${op.id}) AND status='OPEN'`
  )
  const [counts] = await tx.$queryRaw<{ claimedArtworks: bigint; sourceBindings: bigint }[]>(
    Prisma.sql`SELECT (SELECT count(*) FROM "ArtworkDedupClaim" WHERE "operationId"=${op.id}) "claimedArtworks",(SELECT count(*) FROM "ArtworkDedupOperationSource" WHERE "operationId"=${op.id}) "sourceBindings"`
  )
  return { operationId: op.id, executionVersion: op.executionVersion, ...counts! }
}


/** Caller already owns creator catalog before root/source/Artwork locks; maintenance never refreshes proof. */
export async function assertNoArtworkDedupArchiveSourceHold(
  tx: Prisma.TransactionClient,
  input: { providerKey: string; externalId: string }
) {
  const source = await tx.artworkDedupSourceIdentity.findFirst({
    where: { kind: 'PROVIDER', providerKey: input.providerKey, externalId: input.externalId, status: { in: ['HOLD','TOMBSTONE'] } },
    select: { id: true }
  })
  if (source) throw new ArtworkDedupOperationError('SOURCE_HELD')
}

/** PREPARE freezes source generations, without taking a durable HOLD or artwork claim. */
export async function freezeArtworkDedupOperationSources(tx: Prisma.TransactionClient, operationId: string) {
  const op = await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: operationId } })
  const roots = artworkDedupBoundRoots(op.rootBindings)
  await lockCreatorCatalog(tx)
  await lockContentDirectories(tx, [roots.source, roots.archive].map(root => ({ ...root, logicalRoot: root.logicalRoot as MediaContentLogicalRoot, relativeDirectory: '' })))
  const sql = scopeSources(operationId, roots)
  await tx.$executeRaw(Prisma.sql`${sql} INSERT INTO "ArtworkDedupSourceIdentity"(id,"identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId","displayName","updatedAt") SELECT gen_random_uuid()::text,"identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId",'媒体来源',CURRENT_TIMESTAMP FROM(SELECT DISTINCT "identityKey",kind,"logicalRoot","rootIdentity","canonicalPath","providerKey","externalId" FROM sources) s ORDER BY "identityKey" COLLATE "C" ON CONFLICT("identityKey") DO NOTHING`)
  await tx.$queryRaw(Prisma.sql`${sql} SELECT count(*) FROM (SELECT i.id FROM "ArtworkDedupSourceIdentity" i WHERE i."identityKey" IN(SELECT "identityKey" FROM sources) ORDER BY i."identityKey" COLLATE "C" FOR UPDATE OF i) locked`)
  const [held] = await tx.$queryRaw<{held:boolean}[]>(Prisma.sql`${sql} SELECT EXISTS(SELECT 1 FROM sources s JOIN "ArtworkDedupSourceIdentity" i ON i."identityKey"=s."identityKey" WHERE i.status<>'OPEN') held`)
  if (held?.held) throw new ArtworkDedupOperationError('SOURCE_HELD')
  await tx.$executeRaw(Prisma.sql`${sql} INSERT INTO "ArtworkDedupOperationSource"("operationId","artworkId","sourceId","frozenGeneration") SELECT DISTINCT ${op.id},s."artworkId",i.id,i.generation FROM sources s JOIN "ArtworkDedupSourceIdentity" i ON i."identityKey"=s."identityKey" ON CONFLICT DO NOTHING`)
}
