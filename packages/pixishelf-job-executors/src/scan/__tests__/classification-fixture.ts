export function confirmedAnimationFixture(relativePath: string) {
  return {
    previous: {
      id: 11,
      path: relativePath,
      size: 100n,
      sortOrder: 0,
      mediaType: 'ANIMATION' as const,
      webpAnimationStatus: 2,
      animationMetadata: {
        writeInProgress: false,
        sourcePath: relativePath,
        sourceSize: 100n,
        sourceMtimeMs: 1n,
        sourceCtimeMs: 2n,
        sourceDeviceId: 3n,
        sourceInode: 4n,
        status: 'READY'
      }
    },
    sourceState: { sizeBytes: 100n, mtimeMs: 1n, ctimeMs: 2n, deviceId: 3n, inode: 4n }
  }
}
