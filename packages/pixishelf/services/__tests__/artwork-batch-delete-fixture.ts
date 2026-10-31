import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { captureArtworkContentSnapshot, type PrismaClient } from '@pixishelf/db'

export async function seedBatchDeleteFixture(
  db: PrismaClient,
  root: string,
  options: { userId?: string; extraGroups?: number } = {}
) {
  const userId = options.userId ?? `batch-${randomUUID()}`
  await db.userBA.upsert({
    where: { id: userId },
    create: { id: userId, email: `${userId}@test.invalid`, name: '删除验收' },
    update: {}
  })
  const artist = await db.artist.create({ data: { name: '合成样本 · 四来源删除验收' } })
  const run = await db.artworkDedupRun.create({
    data: {
      artistId: artist.id,
      requestedBy: userId,
      idempotencyKey: randomUUID(),
      mode: 'FULL',
      includeSuspectedVersions: true,
      visualStatus: 'COMPLETE',
      status: 'COMPLETED',
      stage: 'DONE',
      finishedAt: new Date(),
      rootBindings: {
        version: 1,
        source: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture' },
        archive: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture' },
        archiveRelativePrefix: ''
      }
    }
  })
  const scanJob = await db.systemJob.create({
    data: {
      type: 'ARTWORK_DEDUP_SCAN',
      definitionVersion: 9,
      status: 'COMPLETED',
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      effectivePriority: 900,
      payload: { runId: run.id, executionVersion: 1 }
    }
  })
  await db.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: scanJob.id } })
  await db.artworkDedupReviewState.create({ data: { runId: run.id, userId } })
  const kinds = ['LOCAL_DIRECTORY', 'PIXIV_SCAN', 'MANUAL_CREATE', 'URL_ARCHIVE'] as const
  const groups: {
    groupId: string
    kind: 'EXACT' | 'CONTAINS' | 'PARTIAL' | 'VISUAL'
    keeper: number
    target: number
    files: string[]
  }[] = []
  const files = new Map<string, string>()
  async function artwork(n: number, side: number) {
    const kind = kinds[(n + side) % 4]!
    const key = randomUUID()
    const directory =
      kind === 'URL_ARCHIVE' ? `sources/fixture/bucket/${key}/revisions/${key}` : `local-imports/fixture/${key}`
    await fs.mkdir(path.join(root, directory), { recursive: true })
    const art = await db.artwork.create({
      data: {
        title: `${['相同内容', '完整包含', '部分重复', '疑似版本'][n] ?? '跨页相同内容'} · ${side ? '待删样本' : '保留样本'} · ${kind}`,
        createdVia: kind,
        source:
          kind === 'PIXIV_SCAN' ? 'PIXIV_IMPORTED' : kind === 'LOCAL_DIRECTORY' ? 'LOCAL_IMPORT' : 'LOCAL_CREATED',
        storagePath: directory,
        storageKey: directory,
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } }
          }
        }
      }
    })
    const bytes = await sharp({
      create: { width: 320, height: 240, channels: 3, background: ['#e4bd99', '#9ab4be', '#aebf95', '#c1a9bc'][n % 4]! }
    })
      .png()
      .toBuffer()
    const relative = `${directory}/0.png`
    const count = n === 1 && side === 0 ? 2 : n === 2 ? 6 : n === 3 ? 10 : 1
    const imageIds: number[] = []
    const gif = Buffer.from(
      '47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
      'hex'
    )
    for (let index = 0; index < count; index++) {
      const animated = (n === 2 || n === 3) && index === count - 1
      const file = `${directory}/${index}.${animated ? 'gif' : 'png'}`
      const content = animated
        ? gif
        : n === 3 || (n === 2 && index === count - 2)
          ? Buffer.concat([bytes, Buffer.from(`fixture-side-${side}-${index}`)])
          : bytes
      await fs.writeFile(path.join(root, file), content)
      files.set(file, createHash('sha256').update(content).digest('hex'))
      const image = await db.image.create({
        data: {
          artworkId: art.id,
          path: file,
          size: BigInt(content.length),
          width: 320,
          height: 240,
          sortOrder: index,
          ...(animated ? { mediaType: 'ANIMATION' } : {})
        }
      })
      imageIds.push(image.id)
    }
    await fs.writeFile(path.join(root, directory, 'notes.txt'), '合成附属文件，应可取消勾选。')
    if (kind === 'URL_ARCHIVE') {
      const ref = await db.artworkExternalRef.create({
        data: {
          artworkId: art.id,
          providerKey: 'fixture',
          externalId: key,
          canonicalUrl: `https://example.test/${key}`,
          locator: {}
        }
      })
      const job = await db.systemJob.create({
        data: { type: 'ARCHIVE_IMPORT', status: 'COMPLETED', triggerSource: 'LEGACY', attempt: 1, payload: {} }
      })
      const imported = await db.archiveImport.create({
        data: {
          systemJobId: job.id,
          phase: 'LEGACY',
          status: 'COMPLETED',
          providerKey: 'fixture',
          externalId: key,
          externalRefId: ref.id,
          submittedUrl: ref.canonicalUrl,
          canonicalUrl: ref.canonicalUrl,
          locator: {},
          normalizedMetadata: {},
          rawMetadata: {},
          metadataHash: 'a'.repeat(64),
          creatorBucket: 'bucket',
          stagingPath: `.archive-staging/${key}`,
          publishedArtworkId: art.id,
          totalItems: 1,
          completedItems: 1
        }
      })
      await db.archiveRevision.create({
        data: {
          id: key,
          artworkId: art.id,
          externalRefId: ref.id,
          archiveImportId: imported.id,
          archivePath: directory,
          manifestPath: `${directory}/manifest.json`,
          mediaSnapshot: [],
          metadataHash: 'a'.repeat(64),
          isCurrent: true
        }
      })
      await fs.writeFile(
        path.join(root, directory, 'manifest.json'),
        JSON.stringify({ revisionId: key, provider: { key: 'fixture', externalId: key }, media: [] })
      )
    }
    const snap = await db.$transaction((tx) => captureArtworkContentSnapshot(tx, { artworkId: art.id }))
    if (snap.status !== 'READY') throw new Error(snap.status)
    const evidence = {
      algorithmVersion: 1,
      sourceRevision: snap.value.revision,
      mediaEpoch: snap.value.mediaEpoch,
      membersSignature: 'b'.repeat(64),
      contentSha256: 'a'.repeat(64),
      fileCount: snap.value.memberCount,
      completedAt: new Date()
    }
    await db.artworkContentFingerprint.create({ data: { artworkId: art.id, ...evidence } })
    await db.artworkDedupItem.create({
      data: {
        runId: run.id,
        artworkId: art.id,
        frozenMediaRevision: art.mediaRevision,
        status: 'COMPLETE',
        snapshotRevision: evidence.sourceRevision,
        mediaEpoch: evidence.mediaEpoch,
        memberCount: snap.value.memberCount,
        membersSignature: evidence.membersSignature,
        contentSha256: evidence.contentSha256
      }
    })
    return { id: art.id, relative, imageIds }
  }
  for (let n = 0; n < 4 + (options.extraGroups ?? 0); n++) {
    const a = await artwork(n, 0),
      b = await artwork(n, 1)
    const kind = (['EXACT', 'CONTAINS', 'PARTIAL', 'VISUAL'] as const)[n] ?? 'EXACT'
    const groupId = `${String(n).padStart(4, '0')}-${randomUUID()}`
    if (kind === 'EXACT') {
      await db.artworkDedupGroup.create({
        data: { id: groupId, runId: run.id, contentSha256: 'a'.repeat(64), memberCount: 2, fileCount: 1n }
      })
      await db.artworkDedupGroupMember.createMany({
        data: [a, b].map((art) => ({ runId: run.id, groupId, artworkId: art.id }))
      })
    } else if (kind === 'CONTAINS') {
      await db.artworkDedupRelation.create({
        data: {
          id: groupId,
          runId: run.id,
          containedArtworkId: b.id,
          containerArtworkId: a.id,
          containedFileCount: 1n,
          containerFileCount: 2n
        }
      })
    } else {
      await db.artworkDedupVisualPair.create({
        data: {
          id: groupId,
          runId: run.id,
          relationKind: kind,
          leftArtworkId: a.id,
          rightArtworkId: b.id,
          summary: {
            evidenceVersion: 'dct63-grid3-crop-local1-v1',
            leftArtworkId: a.id,
            rightArtworkId: b.id,
            leftFileCount: kind === 'PARTIAL' ? '6' : '10',
            rightFileCount: kind === 'PARTIAL' ? '6' : '10',
            pairedCount: kind === 'PARTIAL' ? '5' : '8',
            exactCount: kind === 'PARTIAL' ? '5' : '0',
            similarCount: kind === 'VISUAL' ? '8' : '0',
            leftUnmatchedCount: '1',
            rightUnmatchedCount: '1',
            leftUncheckedCount: kind === 'VISUAL' ? '1' : '0',
            rightUncheckedCount: kind === 'VISUAL' ? '1' : '0'
          }
        }
      })
    }
    if (kind === 'PARTIAL' || kind === 'VISUAL') {
      await db.artworkDedupVisualPage.createMany({
        data: [
          {
            pairId: groupId,
            ordinal: 1,
            kind: kind === 'PARTIAL' ? 'EXACT' : 'SIMILAR',
            leftImageId: a.imageIds[0]!,
            rightImageId: b.imageIds[0]!,
            leftIndex: 0,
            rightIndex: 0
          },
          {
            pairId: groupId,
            ordinal: 2,
            kind: 'UNMATCHED',
            leftImageId: a.imageIds.at(-2)!,
            rightImageId: null,
            leftIndex: a.imageIds.length - 2,
            rightIndex: null
          },
          {
            pairId: groupId,
            ordinal: 3,
            kind: 'UNMATCHED',
            leftImageId: null,
            rightImageId: b.imageIds.at(-2)!,
            leftIndex: null,
            rightIndex: b.imageIds.length - 2
          },
          ...(kind === 'VISUAL'
            ? [
                {
                  pairId: groupId,
                  ordinal: 4,
                  kind: 'UNCHECKED',
                  leftImageId: a.imageIds.at(-1)!,
                  rightImageId: null,
                  leftIndex: a.imageIds.length - 1,
                  rightIndex: null
                },
                {
                  pairId: groupId,
                  ordinal: 5,
                  kind: 'UNCHECKED',
                  leftImageId: null,
                  rightImageId: b.imageIds.at(-1)!,
                  leftIndex: null,
                  rightIndex: b.imageIds.length - 1
                }
              ]
            : [])
        ]
      })
    }
    await db.artworkDedupReview.create({ data: { runId: run.id, userId, groupId, keeperArtworkId: a.id } })
    groups.push({ groupId, kind, keeper: a.id, target: b.id, files: [a.relative, b.relative] })
  }
  await db.artworkDedupReviewState.update({
    where: { runId_userId: { runId: run.id, userId } },
    data: { reviewRevision: groups.length }
  })
  await db.artworkDedupRun.update({
    where: { id: run.id },
    data: {
      groupCount: groups.length,
      artworkCount: groups.length * 2,
      completeArtworks: groups.length * 2,
      processedArtworks: groups.length * 2
    }
  })
  return {
    userId,
    artistId: artist.id,
    runId: run.id,
    groups,
    files,
    input: {
      expectedUserId: userId,
      runId: run.id,
      expectedRunVersion: 1,
      expectedReviewRevision: groups.length,
      selection: { kind: 'EXPLICIT' as const, groupIds: groups.map((group) => group.groupId) }
    }
  }
}
