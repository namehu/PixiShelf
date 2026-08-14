import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { ArchiveError } from './errors'
import { normalizeRelativePath } from './storage'
import { syncArtworkRelationships } from './relationships'

const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  revisionId: z.string().min(1).optional(),
  provider: z.object({
    key: z.string().min(1).max(50),
    externalId: z.string().min(1),
    canonicalUrl: z.url(),
    locator: z.record(z.string(), z.unknown())
  }),
  sourceSnapshot: z.object({
    metadataHash: z.string().length(64),
    normalized: z.record(z.string(), z.unknown()),
    raw: z.record(z.string(), z.unknown())
  }),
  relationships: z.array(z.record(z.string(), z.unknown())).optional(),
  media: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        path: z.string().min(1),
        quality: z.enum(['ORIGINAL', 'DISPLAY']).nullable().optional(),
        mimeType: z.string().nullable().optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.string().regex(/^\d+$/),
        sha256: z.string().length(64),
        sourcePageUrl: z.string().optional(),
        sourcePageLocator: z.unknown().optional()
      })
    )
    .min(1),
  createdAt: z.string().optional()
})

export type ArchiveManifest = z.infer<typeof manifestSchema>

export async function readArchiveManifest(directory: string): Promise<ArchiveManifest> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  } catch (error) {
    throw new ArchiveError('MEDIA_INVALID', 'manifest.json 无法读取或不是有效 JSON', { cause: error })
  }
  return manifestSchema.parse(raw)
}

export async function importArchiveManifest(input: { scanRoot: string; storagePath: string }) {
  // 按 providerKey+externalId 做幂等性判断：若对应外部作品已存在则直接返回 SKIP，避免重复建模重复计数。
  const archiveDirectory = await resolveExistingPathWithinRoot(input.scanRoot, input.storagePath)
  const manifest = await readArchiveManifest(archiveDirectory)
  const existing = await prisma.artworkExternalRef.findUnique({
    where: {
      providerKey_externalId: {
        providerKey: manifest.provider.key,
        externalId: manifest.provider.externalId
      }
    },
    select: { artworkId: true }
  })
  if (existing) return { imported: false, artworkId: existing.artworkId, imageCount: 0 }

  // 读取 manifest 指定文件时逐项校验长度与 SHA-256，防止目录内容与清单不一致导致脏数据注入。
  const media = await Promise.all(
    manifest.media
      .slice()
      .sort((left, right) => left.index - right.index)
      .map(async (item) => {
        const file = await resolveExistingPathWithinRoot(archiveDirectory, item.path)
        const bytes = await readFile(file)
        if (
          BigInt(bytes.length) !== BigInt(item.bytes) ||
          createHash('sha256').update(bytes).digest('hex') !== item.sha256
        ) {
          throw new ArchiveError('MEDIA_INVALID', `Manifest 媒体校验失败: ${item.path}`)
        }
        return {
          ...item,
          databasePath: normalizeRelativePath(path.join(input.storagePath, item.path))
        }
      })
  )
  const metadata = manifest.sourceSnapshot.normalized
  const title = nestedString(metadata, 'titles', 'display') ?? `Archive ${manifest.provider.externalId}`
  const description = nullableString(metadata.description)
  const postedAt = nullableString(metadata.postedAt)

  return prisma.$transaction(async (tx) => {
    // 所有元数据与媒体记录在同一事务内落盘；如果任一步骤失败，将整批回滚，保证艺术家-标签-关系三方状态一致。
    const artwork = await tx.artwork.create({
      data: {
        title,
        description,
        sourceDate: postedAt ? new Date(postedAt) : null,
        sourceUrl: manifest.provider.canonicalUrl,
        originalUrl: manifest.provider.canonicalUrl,
        thumbnailUrl: nullableString(metadata.thumbnailUrl),
        storagePath: normalizeRelativePath(input.storagePath),
        createdVia: 'URL_ARCHIVE',
        source: 'URL_ARCHIVE'
      }
    })
    const sourceRef = await tx.artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: manifest.provider.key,
        externalId: manifest.provider.externalId,
        canonicalUrl: manifest.provider.canonicalUrl,
        locator: toInputJson(manifest.provider.locator),
        metadataHash: manifest.sourceSnapshot.metadataHash,
        fetchedAt: manifest.createdAt ? new Date(manifest.createdAt) : new Date()
      }
    })
    await tx.artworkSourceSnapshot.create({
      data: {
        externalRefId: sourceRef.id,
        providerSchemaVersion: 1,
        normalizedMetadata: toInputJson(metadata),
        rawMetadata: toInputJson(manifest.sourceSnapshot.raw),
        metadataHash: manifest.sourceSnapshot.metadataHash,
        fetchedAt: manifest.createdAt ? new Date(manifest.createdAt) : new Date()
      }
    })
    await tx.artworkRawMetadata.create({
      data: { artworkId: artwork.id, rawMetadataJson: toInputJson(manifest.sourceSnapshot.raw) }
    })
    const tags = Array.isArray(metadata.tags) ? metadata.tags : []
    for (const value of tags) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const namespace = nullableString((value as Record<string, unknown>).namespace)
      const name = nullableString((value as Record<string, unknown>).name)
      if (!namespace || !name) continue
      const tag = await tx.tag.upsert({
        where: { namespace_name: { namespace, name } },
        create: { namespace, name },
        update: {},
        select: { id: true }
      })
      await tx.artworkTag.create({
        data: { artworkId: artwork.id, tagId: tag.id, provenance: 'SOURCE', sourceRefId: sourceRef.id }
      })
    }
    await tx.image.createMany({
      data: media.map((item) => ({
        artworkId: artwork.id,
        path: item.databasePath,
        sortOrder: item.index,
        width: item.width,
        height: item.height,
        size: BigInt(item.bytes),
        mediaType: 'IMAGE'
      }))
    })
    await syncArtworkRelationships(
      tx,
      artwork.id,
      manifest.provider.key,
      manifest.relationships ?? metadata.relationships
    )
    await tx.archiveRevision.create({
      data: {
        id: manifest.revisionId ?? randomUUID(),
        artworkId: artwork.id,
        externalRefId: sourceRef.id,
        archivePath: normalizeRelativePath(input.storagePath),
        manifestPath: normalizeRelativePath(path.join(input.storagePath, 'manifest.json')),
        metadataHash: manifest.sourceSnapshot.metadataHash,
        mediaSnapshot: toInputJson(manifest.media),
        isCurrent: true,
        publishedAt: manifest.createdAt ? new Date(manifest.createdAt) : new Date()
      }
    })
    return { imported: true, artworkId: artwork.id, imageCount: media.length }
  })
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nestedString(value: Record<string, unknown>, parent: string, child: string): string | null {
  const parentValue = value[parent]
  if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) return null
  return nullableString((parentValue as Record<string, unknown>)[child])
}
