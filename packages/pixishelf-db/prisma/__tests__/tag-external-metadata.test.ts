import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations/20260824130000_add_tag_external_metadata/migration.sql'),
  'utf8'
)

describe('tag external metadata migration', () => {
  it('adds the provider state without rewriting existing tags', () => {
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i)
    expect(migration).toContain('CREATE TABLE "tag_external_metadata"')
    expect(migration).toContain('FOREIGN KEY ("tagId") REFERENCES "Tag"("id")')
    expect(migration).toContain('ON DELETE CASCADE')
  })

  it('tracks exactly one checked state per tag and provider', () => {
    expect(schema).toContain('model TagExternalMetadata {')
    expect(schema).toContain('@@unique([tagId, providerKey])')
    expect(schema).toContain('normalizedPayload Json?')
    expect(schema).toContain('lastSystemJobId String?')
    expect(migration).toContain('tag_external_metadata_tagId_providerKey_key')
  })

  it('models complete, partial, empty, and failed outcomes', () => {
    expect(schema).toContain('enum TagExternalMetadataStatus {')
    for (const status of ['SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED']) {
      expect(schema).toContain(status)
      expect(migration).toContain(`'${status}'`)
    }
  })

  it('constrains normalized payload hashes and catalog identifier sizes', () => {
    expect(migration).toContain('tag_external_metadata_payload_hash_check')
    expect(migration).toContain('^[a-f0-9]{64}$')
    const identifiers = [...migration.matchAll(/(?:INDEX|CONSTRAINT)\s+"([^"]+)"/g)].map((match) => match[1]!)
    for (const identifier of identifiers) {
      expect(Buffer.byteLength(identifier, 'utf8'), identifier).toBeLessThanOrEqual(63)
    }
  })
})
