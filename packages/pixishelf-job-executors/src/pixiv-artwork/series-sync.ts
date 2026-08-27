import { Prisma } from '@pixishelf/db'

import type { NormalizedPixivArtworkSeries } from './client.ts'

const PROVIDER_KEY = 'pixiv'

export interface ObservedPixivSeriesState {
  externalRefId: string
  seriesId: number
  title: string
  titleOverridden: boolean
  membership: {
    sortOrder: number
    sourceOrder: number | null
    orderOverridden: boolean
    excludedAt: Date | null
    provenance: 'SOURCE' | 'MANUAL' | 'LEGACY'
    sourceRefId: string | null
  } | null
}

export interface PixivSeriesSyncResult {
  status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA'
  seriesId: number | null
  pixivSeriesId: string | null
  membershipCreated: boolean
  membershipRemoved: boolean
  titleUpdated: boolean
  protectedFields: Array<'title' | 'membership' | 'order'>
}

export async function observePixivSeriesState(
  database: Pick<Prisma.TransactionClient, 'seriesExternalRef'>,
  pixivSeriesId: string,
  artworkId: number
): Promise<ObservedPixivSeriesState | null> {
  const ref = await database.seriesExternalRef.findUnique({
    where: { providerKey_externalId: { providerKey: PROVIDER_KEY, externalId: pixivSeriesId } },
    select: {
      id: true,
      seriesId: true,
      series: {
        select: {
          title: true,
          titleOverridden: true,
          seriesArtworks: {
            where: { artworkId },
            take: 1,
            select: {
              sortOrder: true,
              sourceOrder: true,
              orderOverridden: true,
              excludedAt: true,
              provenance: true,
              sourceRefId: true
            }
          }
        }
      }
    }
  })
  return ref
    ? {
        externalRefId: ref.id,
        seriesId: ref.seriesId,
        title: ref.series.title,
        titleOverridden: ref.series.titleOverridden,
        membership: ref.series.seriesArtworks[0] ?? null
      }
    : null
}

export async function reconcilePixivArtworkSeries(
  transaction: Prisma.TransactionClient,
  input: {
    artworkId: number
    artworkExternalRefId: string
    observation: NormalizedPixivArtworkSeries
    checkedAt: Date
    jobId: string
    refreshExisting: boolean
    observedSeries: ObservedPixivSeriesState | null
  }
): Promise<PixivSeriesSyncResult> {
  if (input.observation.state === 'UNKNOWN') {
    await updateArtworkSeriesStatus(transaction, input, 'PARTIAL', 'PIXIV_SERIES_SCHEMA_INCOMPLETE')
    return emptyResult('PARTIAL')
  }

  const existingSourceMembership = await transaction.seriesArtwork.findUnique({
    where: { sourceRefId: input.artworkExternalRefId },
    select: { seriesId: true }
  })
  if (input.observation.state === 'NONE') {
    if (existingSourceMembership) {
      await transaction.seriesArtwork.delete({ where: { sourceRefId: input.artworkExternalRefId } })
    }
    await updateArtworkSeriesStatus(transaction, input, 'NO_DATA', null)
    return {
      ...emptyResult('NO_DATA'),
      membershipRemoved: existingSourceMembership !== null
    }
  }

  const remote = input.observation
  let seriesRef = await transaction.seriesExternalRef.findUnique({
    where: { providerKey_externalId: { providerKey: PROVIDER_KEY, externalId: remote.id } },
    include: { series: true }
  })
  if (!seriesRef && remote.title === null) {
    await updateArtworkSeriesStatus(transaction, input, 'PARTIAL', 'PIXIV_SERIES_TITLE_MISSING')
    return { ...emptyResult('PARTIAL'), pixivSeriesId: remote.id }
  }

  let titleUpdated = false
  if (!seriesRef) {
    const created = await transaction.series.create({
      data: {
        title: remote.title!,
        source: 'PIXIV',
        externalId: remote.id,
        externalRefs: {
          create: {
            providerKey: PROVIDER_KEY,
            externalId: remote.id,
            sourceTitle: remote.title,
            status: 'SUCCESS',
            lastAttemptAt: input.checkedAt,
            lastSuccessAt: input.checkedAt,
            lastSystemJobId: input.jobId
          }
        }
      },
      include: { externalRefs: true }
    })
    seriesRef = {
      ...created.externalRefs[0]!,
      series: created
    }
    titleUpdated = true
  }

  const protectedFields: PixivSeriesSyncResult['protectedFields'] = []
  const seriesUpdate: Prisma.SeriesUpdateInput = {}
  if (remote.title !== null) {
    if (input.refreshExisting) {
      const observed = input.observedSeries
      if (
        observed &&
        observed.externalRefId === seriesRef.id &&
        observed.seriesId === seriesRef.seriesId &&
        observed.title === seriesRef.series.title &&
        observed.titleOverridden === seriesRef.series.titleOverridden
      ) {
        seriesUpdate.title = remote.title
        seriesUpdate.titleOverridden = false
        titleUpdated ||= remote.title !== seriesRef.series.title || seriesRef.series.titleOverridden
      } else if (!titleUpdated) {
        protectedFields.push('title')
      }
    } else if (!seriesRef.series.titleOverridden) {
      seriesUpdate.title = remote.title
      titleUpdated ||= remote.title !== seriesRef.series.title
    } else if (remote.title !== seriesRef.series.title) {
      protectedFields.push('title')
    }
  }
  if (Object.keys(seriesUpdate).length > 0) {
    await transaction.series.update({ where: { id: seriesRef.seriesId }, data: seriesUpdate })
  }

  let membershipRemoved = false
  if (existingSourceMembership && existingSourceMembership.seriesId !== seriesRef.seriesId) {
    await transaction.seriesArtwork.delete({ where: { sourceRefId: input.artworkExternalRefId } })
    membershipRemoved = true
  }

  const targetMembership = await transaction.seriesArtwork.findUnique({
    where: { seriesId_artworkId: { seriesId: seriesRef.seriesId, artworkId: input.artworkId } }
  })
  let membershipCreated = false
  if (!targetMembership) {
    const nextOrder = remote.order ?? (await nextSeriesOrder(transaction, seriesRef.seriesId))
    await transaction.seriesArtwork.create({
      data: {
        seriesId: seriesRef.seriesId,
        artworkId: input.artworkId,
        sortOrder: nextOrder,
        sourceOrder: remote.order,
        provenance: 'SOURCE',
        sourceRefId: input.artworkExternalRefId
      }
    })
    membershipCreated = true
  } else if (targetMembership.provenance === 'SOURCE' && targetMembership.sourceRefId === input.artworkExternalRefId) {
    const membershipUpdate: Prisma.SeriesArtworkUpdateInput = { sourceOrder: remote.order }
    const observedMembership = input.observedSeries?.membership
    const membershipUnchangedSinceObservation = Boolean(
      observedMembership &&
        observedMembership.sortOrder === targetMembership.sortOrder &&
        observedMembership.sourceOrder === targetMembership.sourceOrder &&
        observedMembership.orderOverridden === targetMembership.orderOverridden &&
        observedMembership.excludedAt?.getTime() === targetMembership.excludedAt?.getTime() &&
        observedMembership.provenance === targetMembership.provenance &&
        observedMembership.sourceRefId === targetMembership.sourceRefId
    )
    if ((input.refreshExisting && membershipUnchangedSinceObservation) || (!input.refreshExisting && !targetMembership.orderOverridden)) {
      if (remote.order !== null) membershipUpdate.sortOrder = remote.order
      if (input.refreshExisting) membershipUpdate.orderOverridden = false
    } else if (
      (input.refreshExisting || targetMembership.orderOverridden) &&
      remote.order !== null &&
      remote.order !== targetMembership.sortOrder
    ) {
      protectedFields.push('order')
    }
    await transaction.seriesArtwork.update({
      where: { seriesId_artworkId: { seriesId: seriesRef.seriesId, artworkId: input.artworkId } },
      data: membershipUpdate
    })
  } else {
    protectedFields.push('membership')
  }

  const status = protectedFields.length > 0 ? 'PARTIAL' : 'SUCCESS'
  const localMemberCount = await transaction.seriesArtwork.count({
    where: { seriesId: seriesRef.seriesId, excludedAt: null }
  })
  await Promise.all([
    transaction.seriesExternalRef.update({
      where: { id: seriesRef.id },
      data: {
        sourceTitle: remote.title,
        status,
        lastAttemptAt: input.checkedAt,
        lastSuccessAt: input.checkedAt,
        lastErrorCode: null,
        lastError: null,
        lastSystemJobId: input.jobId,
        localMemberCount
      }
    }),
    updateArtworkSeriesStatus(transaction, input, status, null)
  ])

  return {
    status,
    seriesId: seriesRef.seriesId,
    pixivSeriesId: remote.id,
    membershipCreated,
    membershipRemoved,
    titleUpdated,
    protectedFields
  }
}

async function nextSeriesOrder(transaction: Prisma.TransactionClient, seriesId: number) {
  const result = await transaction.seriesArtwork.aggregate({ where: { seriesId }, _max: { sortOrder: true } })
  return (result._max.sortOrder ?? 0) + 1
}

async function updateArtworkSeriesStatus(
  transaction: Prisma.TransactionClient,
  input: { artworkExternalRefId: string; checkedAt: Date; jobId: string },
  status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA',
  errorCode: string | null
) {
  await transaction.artworkExternalRef.update({
    where: { id: input.artworkExternalRefId },
    data: {
      seriesSyncStatus: status,
      seriesLastAttemptAt: input.checkedAt,
      ...(status === 'PARTIAL' ? {} : { seriesLastSuccessAt: input.checkedAt }),
      seriesLastErrorCode: errorCode,
      seriesLastError: errorCode === null ? null : 'Pixiv 作品资料没有提供可安全写入的完整系列信息',
      seriesLastSystemJobId: input.jobId
    }
  })
}

function emptyResult(status: PixivSeriesSyncResult['status']): PixivSeriesSyncResult {
  return {
    status,
    seriesId: null,
    pixivSeriesId: null,
    membershipCreated: false,
    membershipRemoved: false,
    titleUpdated: false,
    protectedFields: []
  }
}
