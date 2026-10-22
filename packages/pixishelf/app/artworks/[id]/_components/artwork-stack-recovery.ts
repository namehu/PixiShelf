export interface StackRecovery {
  mediaId: number
  mode: 'complete' | 'stack'
  savedAt: number
}

const key = (artworkId: number, owner: string) => `artwork-stack-recovery:${owner}:${artworkId}`

// Only an explicit source-conflict reload carries state across entries. Ordinary visits start complete.
type StorageSource = Storage | (() => Storage)
export function saveStackRecovery(source: StorageSource, artworkId: number, owner: string, value: StackRecovery) {
  try {
    const storage = typeof source === 'function' ? source() : source
    storage.setItem(key(artworkId, owner), JSON.stringify(value))
  } catch { /* Storage can be disabled, including the window.sessionStorage getter. */ }
}

export function takeStackRecovery(source: StorageSource, artworkId: number, owner: string, now = Date.now()): StackRecovery | null {
  try {
    const storage = typeof source === 'function' ? source() : source
    const raw = storage.getItem(key(artworkId, owner))
    storage.removeItem(key(artworkId, owner))
    if (!raw) return null
    const value = JSON.parse(raw) as StackRecovery
    return Number.isSafeInteger(value.mediaId) && value.mediaId > 0 &&
      (value.mode === 'complete' || value.mode === 'stack') && Number.isFinite(value.savedAt) &&
      now >= value.savedAt && now - value.savedAt < 60_000 ? value : null
  } catch { return null }
}
