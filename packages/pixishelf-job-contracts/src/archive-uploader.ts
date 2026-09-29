export const ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE = 20_260_903 as const

export function archiveUploaderIdentityLockKey(providerKey: string, externalId: string) {
  return `${providerKey}\n${externalId}`
}

export function archiveUploaderUidLockKey(providerKey: string, uploaderUid: string) {
  return `uploader-uid\n${providerKey}\n${uploaderUid}`
}

export function archiveUploaderUrlLockKey(canonicalUrl: string) {
  return `url\n${canonicalUrl}`
}
