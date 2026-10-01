import type { SeriesArtworkRow } from '@/schemas/series-management'

export interface SeriesDraftHistory {
  ids: number[]
  past: number[][]
  future: number[][]
}
export function sameOrder(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
export function changeDraft(state: SeriesDraftHistory, ids: number[]): SeriesDraftHistory {
  if (sameOrder(state.ids, ids)) return state
  return { ids, past: [...state.past.slice(-49), state.ids], future: [] }
}
export function undoDraft(state: SeriesDraftHistory): SeriesDraftHistory {
  const previous = state.past.at(-1)
  return previous
    ? { ids: previous, past: state.past.slice(0, -1), future: [state.ids, ...state.future].slice(0, 50) }
    : state
}
export function redoDraft(state: SeriesDraftHistory): SeriesDraftHistory {
  const next = state.future[0]
  return next ? { ids: next, past: [...state.past.slice(-49), state.ids], future: state.future.slice(1) } : state
}
export function moveDraft(ids: number[], id: number, position: number) {
  if (!ids.includes(id) || !Number.isInteger(position) || position < 1 || position > ids.length) return ids
  const result = ids.filter((value) => value !== id)
  result.splice(position - 1, 0, id)
  return result
}
export function naturalDraftOrder(ids: number[], rows: ReadonlyMap<number, SeriesArtworkRow>) {
  return [...ids].sort((a, b) => rows.get(a)!.sortOrder - rows.get(b)!.sortOrder || a - b)
}
