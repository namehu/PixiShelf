export function archiveSourceLabel(providerKey: string | null, externalId: string | null): string {
  const providerLabel = providerKey === 'e-hentai' ? '' : (providerKey ?? '')
  return [providerLabel, externalId ? `#${externalId}` : ''].filter(Boolean).join(' ')
}
