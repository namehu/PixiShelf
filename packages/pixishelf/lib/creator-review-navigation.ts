const prefix = 'pixishelf:creator-review:'

export function creatorReviewHref(ids: number[], storage: Pick<Storage, 'setItem'> = sessionStorage) {
  if (!ids.length) return '/admin/artists/relations'
  if (ids.length > 10000 || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error('请选择有效的作品')
  const selection = crypto.randomUUID()
  storage.setItem(prefix + selection, JSON.stringify([...new Set(ids)]))
  return '/admin/artists/relations?selection=' + selection
}

export function readCreatorReviewSelection(
  selection: string,
  storage: Pick<Storage, 'getItem'> = sessionStorage
): number[] {
  const value: unknown = JSON.parse(storage.getItem(prefix + selection) ?? 'null')
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 10000 ||
    !value.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new Error('没有找到之前选择的作品，请返回作品管理重新选择。')
  }
  return [...new Set(value)] as number[]
}
