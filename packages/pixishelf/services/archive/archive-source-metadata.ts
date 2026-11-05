/** Gdata's entire-gallery original size; never infer it from downloaded pages. */
export function archiveSourceSizeBytes(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const metadata =
    record.normalizedMetadata &&
    typeof record.normalizedMetadata === 'object' &&
    !Array.isArray(record.normalizedMetadata)
      ? (record.normalizedMetadata as Record<string, unknown>)
      : record
  return typeof metadata.fileSize === 'number' && Number.isSafeInteger(metadata.fileSize) && metadata.fileSize > 0
    ? metadata.fileSize
    : null
}
