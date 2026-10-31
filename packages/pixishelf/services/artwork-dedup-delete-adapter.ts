import 'server-only'
import { Prisma, readArtworkDedupGroupChoices, type ArtworkDedupGroupChoice } from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import { type z } from 'zod'
import {
  artworkDedupVisualSummarySchema,
  type artworkDedupDeleteSelectionInputSchema,
  type artworkDedupDeletePreviewInputSchema
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { artworkDedupMembers } from './artwork-dedup-review-service'
import { assertDeleteAccount, previewArtworkBatchDelete } from './artwork-batch-delete-service'

type Selection = z.infer<typeof artworkDedupDeleteSelectionInputSchema>
const conflict = (message: string): never => {
  throw new TRPCError({ code: 'CONFLICT', message })
}
export async function resolveArtworkDedupDeleteSelection(userId: string, input: Selection) {
  assertDeleteAccount(userId, input.expectedUserId)
  return prisma.$transaction(async (client) => {
    const tx = client as unknown as Prisma.TransactionClient
    const run = await tx.artworkDedupRun.findUnique({ where: { id: input.runId } })
    const review = await tx.artworkDedupReviewState.findUnique({
      where: { runId_userId: { runId: input.runId, userId } }
    })
    if (
      !run ||
      run.status !== 'COMPLETED' ||
      run.version !== input.expectedRunVersion ||
      (review?.reviewRevision ?? 0) !== input.expectedReviewRevision
    ) {
      conflict('检查或保留选择已变化，请刷新后重试')
    }
    const choices: ArtworkDedupGroupChoice[] = []
    if (input.selection.kind === 'EXPLICIT') {
      const ids = [...new Set(input.selection.groupIds)]
      if (ids.length) {
        choices.push(
          ...(await tx.$queryRaw<ArtworkDedupGroupChoice[]>(
            Prisma.sql`SELECT * FROM artwork_dedup_group_choices(${input.runId},${userId}) c WHERE c."groupId" IN (${Prisma.join(ids)}) ORDER BY c."groupId"`
          ))
        )
      }
    } else {
      let afterGroupId = ''
      while (true) {
        const page = await readArtworkDedupGroupChoices(tx, { runId: input.runId, userId, afterGroupId, limit: 101 })
        choices.push(...page)
        if (page.length < 101) break
        afterGroupId = page.at(-1)!.groupId
      }
    }
    const selection = input.selection
    const groups = choices.filter((choice) =>
      selection.kind === 'EXPLICIT'
        ? selection.groupIds.includes(choice.groupId)
        : selection.manualGroupIds.includes(choice.groupId) ||
          (['EXACT', 'CONTAINS'].includes(choice.relationKind) &&
            choice.eligible &&
            choice.keeperArtworkId !== null &&
            !selection.excludedGroupIds.includes(choice.groupId))
    )
    const explicit = selection.kind === 'EXPLICIT' ? selection.groupIds : selection.manualGroupIds
    if (explicit.some((id) => !groups.some((group) => group.groupId === id))) {
      conflict('部分选择已不在本次检查中，请刷新后重试')
    }
    if (groups.length > 1000) conflict('一次最多处理 1,000 组，请分批选择')
    for (const group of groups) {
      if (!group.eligible || group.keeperArtworkId === null) conflict(`结果 ${group.groupId} 需要先选择保留作品`)
      if (['PARTIAL', 'VISUAL'].includes(group.relationKind) && !group.saved) {
        conflict('部分重复和疑似版本必须手动选择保留方')
      }
      if (group.relationKind === 'CONTAINS' && group.containerArtworkId !== group.keeperArtworkId) {
        conflict('完整包含只能保留完整方')
      }
    }
    const members = groups.length
      ? await tx.$queryRaw<{ groupId: string; artworkId: number }[]>(
          Prisma.sql`SELECT "groupId","artworkId" FROM "ArtworkDedupResultMember" WHERE "runId"=${input.runId} AND "groupId" IN (${Prisma.join(groups.map((group) => group.groupId))})`
        )
      : []
    const keepers = [...new Set(groups.map((group) => group.keeperArtworkId!))]
    const targets = [
      ...new Set(
        members
          .filter(
            (member) => member.artworkId !== groups.find((group) => group.groupId === member.groupId)!.keeperArtworkId
          )
          .map((member) => member.artworkId)
      )
    ].sort((a, b) => a - b)
    const conflicts = keepers.filter((id) => targets.includes(id))
    if (conflicts.length) {
      const artworks = await tx.artwork.findMany({
        where: { id: { in: conflicts } },
        select: { id: true, title: true }
      })
      conflict(
        `保留与待删冲突：${artworks.map((artwork) => `#${artwork.id}「${artwork.title}」`).join('、')}。请取消冲突组或调整保留选择。`
      )
    }
    return { artworkIds: targets, keeperArtworkIds: keepers, groups, groupIds: groups.map((group) => group.groupId) }
  })
}

export async function previewArtworkDedupBatchDelete(
  userId: string,
  input: z.infer<typeof artworkDedupDeletePreviewInputSchema>
) {
  const resolved = await resolveArtworkDedupDeleteSelection(userId, input)
  const losses = await prisma.$transaction(async (client) => {
    const tx = client as unknown as Prisma.TransactionClient
    const members = await artworkDedupMembers(tx, userId, resolved.artworkIds)
    return members.map((member) => {
      let unmatched = 0n
      let unchecked: bigint | null = 0n
      for (const group of resolved.groups) {
        if (!['PARTIAL', 'VISUAL'].includes(group.relationKind) || !group.visual) continue
        const summary = artworkDedupVisualSummarySchema.parse(group.visual)
        if (summary.leftArtworkId !== member.artworkId && summary.rightArtworkId !== member.artworkId) continue
        const left = summary.leftArtworkId === member.artworkId
        const unpaired = BigInt(left ? summary.leftUnmatchedCount : summary.rightUnmatchedCount)
        const rawUnchecked = left ? summary.leftUncheckedCount : summary.rightUncheckedCount
        const unverified = rawUnchecked == null ? null : BigInt(rawUnchecked)
        if (unpaired > unmatched) unmatched = unpaired
        if (unverified === null) unchecked = null
        else if (unchecked !== null && unverified > unchecked) unchecked = unverified
      }
      return {
        artworkId: member.artworkId,
        unmatched: unmatched.toString(),
        unchecked: unchecked?.toString() ?? null,
        member
      }
    })
  })
  return previewArtworkBatchDelete(
    userId,
    { expectedUserId: input.expectedUserId, artworkIds: resolved.artworkIds, idempotencyKey: input.idempotencyKey },
    { runId: input.runId, groupIds: resolved.groupIds, keeperArtworkIds: resolved.keeperArtworkIds, losses }
  )
}
