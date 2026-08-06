export type PersistedImageSize = number | bigint | null | undefined

const MAX_SAFE_IMAGE_SIZE = BigInt(Number.MAX_SAFE_INTEGER)

export function toDatabaseImageSize(size: number | null | undefined): bigint | null {
  if (size == null) return null
  assertSafeImageSizeNumber(size)
  return BigInt(size)
}

export function toApiImageSize(size: PersistedImageSize): number | null {
  if (size == null) return null

  if (typeof size === 'bigint') {
    if (size < BigInt(0) || size > MAX_SAFE_IMAGE_SIZE) {
      throw new Error(`Image size is outside the safe JavaScript integer range: ${size.toString()}`)
    }
    return Number(size)
  }

  assertSafeImageSizeNumber(size)
  return size
}

export function normalizeImageSizeField<T extends { size?: PersistedImageSize }>(
  image: T
): Omit<T, 'size'> & { size: number | null } {
  return {
    ...image,
    size: toApiImageSize(image.size)
  }
}

function assertSafeImageSizeNumber(size: number) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid image size: ${String(size)}`)
  }
}
