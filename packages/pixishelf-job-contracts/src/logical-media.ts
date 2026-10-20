import { VIDEO_FILE_EXTENSIONS } from './media-types.ts'

const isApngFile = (value: string) => /\.apng$/i.test(value)
const isVideoFile = (value: string) => {
  const filename = value.replace(/\?.*$/, '')
  const dot = filename.lastIndexOf('.')
  return dot >= 0 && (VIDEO_FILE_EXTENSIONS as readonly string[]).includes(filename.slice(dot).toLowerCase())
}

export interface LogicalMediaSource {
  id: number
  path: string
  mediaType?: string | null
}

export interface LogicalMediaGroup<T extends LogicalMediaSource> {
  item: T
  members: T[]
}

function stem(mediaPath: string) {
  const name = mediaPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && name !== '..' ? name.slice(0, dot) : name
}

function isVideo(item: LogicalMediaSource) {
  return item.mediaType?.toUpperCase() === 'VIDEO' || isVideoFile(item.path)
}

/** The same APNG/video grouping used for the complete artwork display sequence. */
export function groupLogicalMedia<T extends LogicalMediaSource>(items: T[]): LogicalMediaGroup<T>[] {
  const firstVideoByStem = new Map<string, T>()
  for (const item of items) {
    if (isVideo(item)) {
      const key = stem(item.path)
      if (!firstVideoByStem.has(key)) firstVideoByStem.set(key, item)
    }
  }

  const ownerByMemberId = new Map<number, number>()
  for (const item of items) {
    if (!isApngFile(item.path)) continue
    const owner = firstVideoByStem.get(stem(item.path))
    if (owner && owner.id !== item.id) ownerByMemberId.set(item.id, owner.id)
  }

  const groups = items.filter((item) => !ownerByMemberId.has(item.id)).map((item) => ({ item, members: [item] }))
  const byOwnerId = new Map(groups.map((group) => [group.item.id, group]))
  for (const item of items) {
    const ownerId = ownerByMemberId.get(item.id)
    if (ownerId !== undefined) byOwnerId.get(ownerId)?.members.push(item)
  }
  return groups
}
