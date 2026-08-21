import { createHash } from 'node:crypto'

export interface MetadataDigestRow {
  ordinal: number
  relativePath: string
  contentHash: string | null
}

export interface AuditMetadataDigestRow {
  ordinal: number
  relativePath: string
  sizeBytes: bigint | null
  mtimeMs: bigint | null
  ctimeMs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

export interface ArtistMappingDigestRow {
  ordinal: number
  artistDirectory: string
  artistId: number
}

export interface LocalWorkDigestRow {
  ordinal: number
  kind: string
  relativePath: string
  fingerprint: string | null
}

export function metadataInputDigest(rows: readonly MetadataDigestRow[]): string {
  return digestCanonicalRows(
    [...rows]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => `${row.ordinal}\0${row.relativePath}\0${row.contentHash ?? ''}`)
  )
}

export function artistMappingInputDigest(rows: readonly ArtistMappingDigestRow[]): string {
  return digestCanonicalRows(
    [...rows]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => `${row.ordinal}\0${row.artistDirectory}\0${row.artistId}`)
  )
}

export function localWorkInputDigest(rows: readonly LocalWorkDigestRow[]): string {
  return digestCanonicalRows(
    [...rows]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => `${row.ordinal}\0${row.kind}\0${row.relativePath}\0${row.fingerprint ?? ''}`)
  )
}

export function createMetadataDigestAccumulator() {
  return createAccumulator((row: MetadataDigestRow) => `${row.ordinal}\0${row.relativePath}\0${row.contentHash ?? ''}`)
}

export function createAuditMetadataDigestAccumulator() {
  return createAccumulator(
    (row: AuditMetadataDigestRow) =>
      `${row.ordinal}\0${row.relativePath}\0${canonicalBigInt(row.sizeBytes)}\0${canonicalBigInt(row.mtimeMs)}\0${canonicalBigInt(row.ctimeMs)}\0${canonicalBigInt(row.deviceId)}\0${canonicalBigInt(row.inode)}`
  )
}

export function createArtistMappingDigestAccumulator() {
  return createAccumulator((row: ArtistMappingDigestRow) => `${row.ordinal}\0${row.artistDirectory}\0${row.artistId}`)
}

export function createLocalWorkDigestAccumulator() {
  return createAccumulator(
    (row: LocalWorkDigestRow) => `${row.ordinal}\0${row.kind}\0${row.relativePath}\0${row.fingerprint ?? ''}`
  )
}

function digestCanonicalRows(rows: readonly string[]): string {
  const hash = createHash('sha256')
  for (const row of rows) hash.update(row).update('\n')
  return hash.digest('hex')
}

function createAccumulator<TRow>(canonicalize: (row: TRow) => string) {
  const hash = createHash('sha256')
  let finalized = false
  return {
    update(row: TRow) {
      if (finalized) throw new Error('Digest accumulator is already finalized')
      hash.update(canonicalize(row)).update('\n')
    },
    digest() {
      if (finalized) throw new Error('Digest accumulator is already finalized')
      finalized = true
      return hash.digest('hex')
    }
  }
}

function canonicalBigInt(value: bigint | null): string {
  return value === null ? '' : value.toString(10)
}
