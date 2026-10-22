import { createSerializer, parseAsBoolean, parseAsInteger, parseAsString } from 'nuqs'
import {
  artworkQuerySnapshotSchema,
  readingFilterLabels,
  type ArtworkQuerySnapshot
} from '@/schemas/artwork-quick-filter.dto'
import { MSource } from '@/enums/e-source'

const string = (value = '') =>
  parseAsString.withDefault(value).withOptions({ history: 'replace', clearOnDefault: true })
export const artworkQueryParsers = {
  search: string(),
  sortBy: string('source_date_desc'),
  randomSeed: string(),
  mediaType: string('all'),
  startDate: string(),
  endDate: string(),
  createdStartDate: string(),
  createdEndDate: string(),
  artistId: parseAsInteger.withOptions({ history: 'replace', clearOnDefault: true }),
  artistLabel: string(),
  tags: string(),
  tagLabels: string(),
  sources: string(),
  hasAudio: string('all'),
  readingStatus: string('all'),
  likedOnly: parseAsBoolean.withDefault(false).withOptions({ history: 'replace', clearOnDefault: true })
}
export function snapshotToQuery(input: ArtworkQuerySnapshot, seed?: number) {
  const q = artworkQuerySnapshotSchema.parse(input)
  return {
    search: q.search || null,
    mediaType: q.mediaType,
    sortBy: q.sortBy,
    randomSeed: q.sortBy === 'random' ? String(seed ?? Math.floor(Math.random() * 2147483646) + 1) : null,
    artistId: q.artist[0] ? Number(q.artist[0].value) : null,
    artistLabel: q.artist[0]?.label || null,
    tags: q.tags.map((t) => t.value).join(',') || null,
    tagLabels: q.tags.map((t) => encodeURIComponent(t.label)).join(',') || null,
    sources: q.sources.join(',') || null,
    hasAudio: q.hasAudio,
    readingStatus: q.readingStatus,
    likedOnly: q.likedOnly || null,
    startDate: q.startDate || null,
    endDate: q.endDate || null,
    createdStartDate: q.createdStartDate || null,
    createdEndDate: q.createdEndDate || null
  }
}
export function snapshotHref(q: ArtworkQuerySnapshot) {
  return createSerializer(artworkQueryParsers)('/artworks', snapshotToQuery(q))
}
export function queryToSnapshot(params: URLSearchParams): ArtworkQuerySnapshot {
  const csv = (key: string) => (params.get(key) || '').split(',').filter(Boolean)
  const labels = csv('tagLabels').map((v) => {
    try {
      return decodeURIComponent(v)
    } catch {
      return v
    }
  })
  return artworkQuerySnapshotSchema.parse({
    ...Object.fromEntries(params),
    likedOnly: params.get('likedOnly') === 'true',
    artist: params.get('artistId')
      ? [{ value: params.get('artistId'), label: params.get('artistLabel') || `#${params.get('artistId')}` }]
      : [],
    tags: csv('tags').map((value, i) => ({ value, label: labels[i] || `#${value}` })),
    sources: csv('sources')
  })
}
export function describeSnapshot(q: ArtworkQuerySnapshot) {
  const sort = {
    source_date_desc: '原始时间 ↓',
    source_date_asc: '原始时间 ↑',
    created_at_desc: '入库时间 ↓',
    created_at_asc: '入库时间 ↑',
    title_asc: '标题 A–Z',
    title_desc: '标题 Z–A',
    artist_asc: '艺术家 A–Z',
    artist_desc: '艺术家 Z–A',
    images_desc: '图片数量 ↓',
    images_asc: '图片数量 ↑',
    random: '随机排序'
  }
  return [
    q.search && `关键词：${q.search}`,
    q.readingStatus !== 'all' && readingFilterLabels[q.readingStatus],
    q.likedOnly && '我的喜欢',
    q.mediaType !== 'all' && { image: '图片', animation: '动图', video: '视频' }[q.mediaType],
    ...q.artist.map((a) => a.label),
    ...q.tags.map((t) => `#${t.label}`),
    ...q.sources.map((s) => MSource[s]),
    q.hasAudio !== 'all' && (q.hasAudio === 'yes' ? '有音频' : '无音频'),
    (q.startDate || q.endDate) && `原始：${q.startDate || '不限'}—${q.endDate || '不限'}`,
    (q.createdStartDate || q.createdEndDate) && `入库：${q.createdStartDate || '不限'}—${q.createdEndDate || '不限'}`,
    sort[q.sortBy]
  ]
    .filter(Boolean)
    .join(' · ')
}
