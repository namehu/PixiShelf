const LEGACY_NOTICE = '检测到 E-Hentai 画廊版本替代关系，将在关联作品存在时建立显式关系'
const HISTORY_NOTICE = '解析时发现此画廊关联了历史版本，不影响本次归档。'
const NEWER_NOTICE = '解析时此链接已是旧版，远端另有更新版本；本次仍归档此链接，新版需另行添加，不会覆盖旧版。'
const UNKNOWN_NOTICE = '解析时记录了画廊版本关系，但历史快照不足以区分新旧版本。'
const VERSION_NOTICES = new Set([LEGACY_NOTICE, HISTORY_NOTICE, NEWER_NOTICE, UNKNOWN_NOTICE])

/** Describes the frozen provider response, never a change observed during download. */
export function getEhentaiVersionNotice(externalId: string, relationships: unknown): string | null {
  if (!Array.isArray(relationships)) return null
  let hasHistory = false
  for (const value of relationships) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const relation = value as Record<string, unknown>
    if (
      relation.type !== 'REPLACES' ||
      relation.providerKey !== 'e-hentai' ||
      typeof relation.externalId !== 'string' ||
      !/^[1-9]\d*$/.test(relation.externalId) ||
      relation.externalId === externalId
    ) {
      continue
    }
    // An intermediate version can have both edges; the newer-version notice takes priority.
    if (relation.direction === 'INBOUND') return NEWER_NOTICE
    if (relation.direction === 'OUTBOUND') hasHistory = true
  }
  return hasHistory ? HISTORY_NOTICE : null
}

/** Re-project old task messages without rewriting persisted snapshots or unrelated warnings. */
export function formatArchiveVersionWarning(input: {
  providerKey: string
  externalId: string
  normalizedMetadata: unknown
  warning: string | null
}): string | null {
  if (input.providerKey !== 'e-hentai') return input.warning
  const metadata = input.normalizedMetadata
  const relationships =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).relationships
      : undefined
  const notice = getEhentaiVersionNotice(input.externalId, relationships)
  let hadVersionNotice = false
  const otherWarnings = (input.warning ?? '').split(/\r?\n/).filter((line) => {
    if (!VERSION_NOTICES.has(line.trim())) return true
    hadVersionNotice = true
    return false
  })
  if (!notice && !hadVersionNotice) return input.warning
  return [...otherWarnings.filter((line) => line.trim()), notice ?? UNKNOWN_NOTICE].join('\n')
}
